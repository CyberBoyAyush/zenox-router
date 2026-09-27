import { resolveCascade, type RouterConfig } from "../config/schema"
import { classifyRequest, JevClassificationError } from "../jev/classify"
import { DEFAULT_CATEGORIES, DEFAULT_FALLBACK_CATEGORY_ID } from "../jev/categories"
import { HealthTracker } from "../routing/health"
import { SpendLedger } from "../routing/budget"
import { selectModel, type CascadeDeps } from "../routing/cascade"
import { estimateTokens } from "../context/limits"
import { resolveProviderApiKey } from "../config/resolve-credentials"
import { loadCredentials } from "../config/credentials"
import type { ModelsDevCatalog } from "../modelsdev/client"
import type { ManualLimits } from "../context/limits"
import {
  type OpenAIChatRequest,
  type OpenAIChatResponse,
  buildRecentContext,
  contentToText,
  extractLatestUserText,
  contextLengthExceededBody,
  openAIErrorBody,
} from "./openai-types"
import { toAnthropicRequest, callAnthropicNonStreaming, parseAnthropicResponse, startAnthropicStream, parseAnthropicSSE, type StreamUsage } from "../routing/providers/anthropic-translate"
import { callOpenAICompatible, callOpenAICompatibleStreamStart } from "../routing/providers/openai-compatible"
import { isXaiDisguisedOverload } from "../routing/providers/classify-error"

/**
 * excludeRefs strictly grows by one distinct ref per non-success iteration
 * (see the loop below), so selectModel is guaranteed to report exhaustion
 * once excludeRefs covers every configured ref — this bound only guards
 * against a genuine bug causing the same ref to be retried without being
 * excluded, never against legitimately trying every configured model once.
 */
function maxCascadeAttempts(config: RouterConfig): number {
  const distinctRefs = new Set(config.categories.flatMap((c) => resolveCascade(c, config.categories)))
  return Math.max(distinctRefs.size * 2, 10)
}

export interface ProxyDeps {
  config: RouterConfig
  catalog: ModelsDevCatalog
  manualLimits: ManualLimits
  health: HealthTracker
  budget: SpendLedger
  jevApiKey: string
}

export interface ProxyResult {
  status: number
  headers: Record<string, string>
  /** Present for non-streaming responses. */
  bodyText?: string
  /** Present for streaming responses — the caller relays these as SSE. */
  stream?: AsyncGenerator<string, void, unknown>
  /** Which category/model actually served this, for diagnostics/logging (not sent to the client). */
  diagnostics?: { categoryId: string; ref: string; crossCategoryFallback: boolean }
}

function baseUrlFor(catalog: ModelsDevCatalog, providerID: string): string | undefined {
  return catalog[providerID]?.api
}

/** Full request content, including array-content parts (images/multiple text blocks) — used for token estimation. Previously this silently treated any non-string content as empty, undercounting real conversations. */
function fullConversationText(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = []
  for (const m of messages) {
    parts.push(contentToText(m.content))
    if (m.tool_calls) parts.push(JSON.stringify(m.tool_calls))
  }
  return parts.join("\n")
}

/**
 * Classifies the request (unless a precomputed category is already known),
 * walks the cascade, calls the real downstream provider, and returns an
 * OpenAI-compatible result. Every downstream call is wrapped so a network
 * failure or malformed response is treated as a classified cascade failure
 * (advance to the next candidate) rather than an uncaught exception that
 * would skip health tracking and crash the request.
 */
export async function handleChatCompletion(
  request: OpenAIChatRequest,
  precomputedCategoryId: string | undefined,
  deps: ProxyDeps,
): Promise<ProxyResult> {
  const { config, catalog, manualLimits, health, budget } = deps

  let categoryId = precomputedCategoryId
  if (!categoryId) {
    const latestMessage = extractLatestUserText(request.messages)
    const recentContext = buildRecentContext(request.messages, config.recentContextChars)
    try {
      const result = await classifyRequest({
        message: latestMessage || "(no text content)",
        recentContext,
        categories: config.categories,
        apiKey: deps.jevApiKey,
      })
      categoryId = result.confidence >= config.confidenceThreshold ? result.categoryId : config.defaultCategoryId
    } catch {
      // Jev being unreachable should never take the whole router down — fall back to the default category.
      categoryId = config.defaultCategoryId
    }
  }
  if (!config.categories.some((c) => c.id === categoryId)) categoryId = config.defaultCategoryId

  const conversationTokens = estimateTokens(fullConversationText(request.messages))

  const cascadeDeps: CascadeDeps = { health, budget, catalog, manualLimits, config }
  const excludeRefs = new Set<string>()
  const maxAttempts = maxCascadeAttempts(config)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const selection = selectModel(categoryId, conversationTokens, cascadeDeps, excludeRefs)
    if (!selection.ok) {
      if (selection.error === "context-overflow") {
        return { status: 413, headers: { "content-type": "application/json" }, bodyText: JSON.stringify(contextLengthExceededBody("The conversation is too large for any configured model.")) }
      }
      return { status: 503, headers: { "content-type": "application/json" }, bodyText: JSON.stringify(openAIErrorBody("Every configured model is currently unavailable (rate-limited, out of budget, or out of quota). Try again shortly, or check `zenox-router status`.", "all_models_exhausted")) }
    }

    const { ref, categoryId: servedByCategoryId, crossCategoryFallback } = selection.selection
    const [providerID, ...rest] = ref.split("/")
    const modelID = rest.join("/")
    if (!providerID) {
      excludeRefs.add(ref)
      continue
    }
    const apiKey = resolveProviderApiKey(providerID, config.credentialSource)
    if (!apiKey) {
      // Missing credentials is a config error for THIS model, not this request — don't mark it unhealthy long-term, just skip it now.
      excludeRefs.add(ref)
      continue
    }

    const onUsage = (usage: { inputTokens: number; outputTokens: number }) => {
      budget.record(servedByCategoryId, estimateActualCost(catalog, ref, usage))
    }

    const result = await callDownstreamSafe(providerID, modelID, apiKey, request, catalog, manualLimits, onUsage)

    if (result.kind === "success") {
      // The initial HTTP handshake succeeded (2xx, or the stream connected) — record that now, since
      // rate-limit headers from THIS response are already known and useful for future routing decisions.
      // A mid-stream failure (connection drop, Anthropic `error` event, xAI's disguised-overload check)
      // is still possible after this point; withMidStreamHealthTracking below records a SECOND, corrective
      // failure if that happens, so health state stays accurate even though the client-facing response
      // (already committed to 200 by the time a mid-stream failure can be detected) can't be un-sent.
      health.recordSuccess(ref, result.headers)
      if (result.usage) budget.record(servedByCategoryId, estimateActualCost(catalog, ref, result.usage))
      return {
        status: 200,
        headers: { "content-type": result.stream ? "text/event-stream" : "application/json" },
        bodyText: result.bodyText,
        stream: result.stream ? withMidStreamHealthTracking(result.stream, ref, health) : undefined,
        diagnostics: { categoryId: servedByCategoryId, ref, crossCategoryFallback },
      }
    }

    if (result.kind === "xai-disguised-overload") {
      excludeRefs.add(ref)
      continue
    }

    // Any non-success outcome (including network/parse exceptions, normalized inside callDownstreamSafe)
    // — record it (updates health/circuit-breaker state) and let the loop advance to the next candidate.
    health.recordFailure(ref, result.status, result.headers, result.bodyText)
    excludeRefs.add(ref)
  }

  return { status: 503, headers: { "content-type": "application/json" }, bodyText: JSON.stringify(openAIErrorBody("Exhausted all cascade attempts for this request.", "cascade_exhausted")) }
}

/** Iterates `stream`, passing chunks through unchanged, but calls `health.recordFailure` if the generator throws mid-iteration — the client-facing response has already committed to 200 by the time this can happen, so this can't fix THIS request, but it keeps health state accurate for the NEXT one instead of silently recording a permanent false success. Re-throws so the HTTP layer still ends the connection abruptly rather than pretending the stream completed cleanly. */
async function* withMidStreamHealthTracking(stream: AsyncGenerator<string, void, unknown>, ref: string, health: HealthTracker): AsyncGenerator<string, void, unknown> {
  try {
    yield* stream
  } catch (err) {
    health.recordFailure(ref, 599, new Headers(), err instanceof Error ? err.message : String(err))
    throw err
  }
}

type DownstreamOutcome =
  | { kind: "success"; headers: Headers; bodyText?: string; stream?: AsyncGenerator<string, void, unknown>; usage?: { inputTokens: number; outputTokens: number } }
  | { kind: "failure"; status: number; headers: Headers; bodyText: string }
  | { kind: "xai-disguised-overload" }

/** Wraps callDownstream so a thrown network/parse error becomes a classified failure instead of an uncaught exception that would skip health tracking and crash the whole request. */
async function callDownstreamSafe(
  providerID: string,
  modelID: string,
  apiKey: string,
  request: OpenAIChatRequest,
  catalog: ModelsDevCatalog,
  manualLimits: ManualLimits,
  onUsage: (usage: StreamUsage) => void,
): Promise<DownstreamOutcome> {
  try {
    return await callDownstream(providerID, modelID, apiKey, request, catalog, manualLimits, onUsage)
  } catch (err) {
    // Network failure (DNS, connection refused, timeout) or an unexpected response shape we couldn't
    // parse. Treated as a generic server error (cooldown-classified for every provider) so the cascade
    // still advances instead of the whole request crashing uncaught.
    return { kind: "failure", status: 599, headers: new Headers(), bodyText: JSON.stringify(openAIErrorBody(err instanceof Error ? err.message : String(err))) }
  }
}

async function callDownstream(
  providerID: string,
  modelID: string,
  apiKey: string,
  request: OpenAIChatRequest,
  catalog: ModelsDevCatalog,
  manualLimits: ManualLimits,
  onUsage: (usage: StreamUsage) => void,
): Promise<DownstreamOutcome> {
  const ref = `${providerID}/${modelID}`
  const limits = catalog[providerID]?.models[modelID]?.limit ?? manualLimits[ref]
  const maxOutputTokens = Math.min(request.max_tokens ?? limits?.output ?? 8000, limits?.output ?? 8000)

  if (providerID === "anthropic") {
    const anthropicReq = toAnthropicRequest({ ...request, model: modelID }, maxOutputTokens)
    if (request.stream) {
      const response = await startAnthropicStream(apiKey, anthropicReq)
      if (!response.ok) {
        const bodyText = await response.text()
        return { kind: "failure", status: response.status, headers: response.headers, bodyText }
      }
      return { kind: "success", headers: response.headers, stream: sseFromChunks(parseAnthropicSSE(response, onUsage)) }
    }
    const result = await callAnthropicNonStreaming(apiKey, anthropicReq)
    if (result.status !== 200) return { kind: "failure", status: result.status, headers: result.headers, bodyText: result.bodyText }
    const openaiShape = parseAnthropicResponse(result.bodyText)
    return {
      kind: "success",
      headers: result.headers,
      bodyText: JSON.stringify(openaiShape),
      usage: { inputTokens: openaiShape.usage?.prompt_tokens ?? 0, outputTokens: openaiShape.usage?.completion_tokens ?? 0 },
    }
  }

  const baseUrl = baseUrlFor(catalog, providerID)
  if (!baseUrl) return { kind: "failure", status: 500, headers: new Headers(), bodyText: JSON.stringify(openAIErrorBody(`No known API base URL for provider "${providerID}"`)) }

  const forwardRequest: OpenAIChatRequest = { ...request, model: modelID, max_tokens: maxOutputTokens }

  if (request.stream) {
    // Ask for a trailing usage chunk so streaming requests can still be budgeted accurately — most
    // OpenAI-compatible providers (OpenAI itself, and the @ai-sdk/openai-compatible-based majority of
    // models.dev providers) support this option; providers that ignore it simply omit the field, no harm
    // done. Merged (not replaced) in case the caller already set its own stream_options.
    const withUsage: OpenAIChatRequest = {
      ...forwardRequest,
      stream_options: { ...(forwardRequest.stream_options as Record<string, unknown> | undefined), include_usage: true },
    }
    const response = await callOpenAICompatibleStreamStart(baseUrl, apiKey, withUsage)
    if (!response.ok || !response.body) {
      const bodyText = await response.text()
      return { kind: "failure", status: response.status, headers: response.headers, bodyText }
    }
    return { kind: "success", headers: response.headers, stream: relayUpstreamSSE(response.body, providerID, onUsage) }
  }

  const result = await callOpenAICompatible(baseUrl, apiKey, forwardRequest)
  if (result.status !== 200) return { kind: "failure", status: result.status, headers: result.headers, bodyText: result.bodyText }

  if (providerID === "xai") {
    let parsed: unknown
    try {
      parsed = JSON.parse(result.bodyText)
    } catch {
      parsed = undefined
    }
    if (isXaiDisguisedOverload(parsed)) return { kind: "xai-disguised-overload" }
  }

  let usage: { inputTokens: number; outputTokens: number } | undefined
  try {
    const parsed = JSON.parse(result.bodyText) as OpenAIChatResponse
    if (parsed.usage) usage = { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens }
  } catch {
    usage = undefined
  }

  return { kind: "success", headers: result.headers, bodyText: result.bodyText, usage }
}

async function* sseFromChunks(chunks: AsyncGenerator<Record<string, unknown>, void, unknown>): AsyncGenerator<string, void, unknown> {
  for await (const c of chunks) {
    yield `data: ${JSON.stringify(c)}\n\n`
  }
  yield "data: [DONE]\n\n"
}

/**
 * Already-OpenAI-shape SSE from a compatible upstream — relay byte-for-byte,
 * no translation needed, but still parse each COMPLETE line for a trailing
 * `usage` field (from stream_options.include_usage) to report real spend,
 * and confirm a `[DONE]` terminator was actually seen before treating EOF
 * as a clean completion.
 *
 * Only lines already terminated by a newline are ever parsed — an earlier
 * version parsed whatever was in the buffer on every read, including a
 * complete-looking JSON line that hadn't been newline-terminated yet by the
 * transport; if that same line then arrived (now complete) in the NEXT
 * chunk, it was parsed and billed a second time. Buffering only the
 * trailing partial line (the same safe pattern used in
 * anthropic-translate.ts's parseAnthropicSSE) avoids this.
 */
async function* relayUpstreamSSE(body: ReadableStream<Uint8Array>, providerID: string, onUsage: (usage: StreamUsage) => void): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let sawDone = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        if (!sawDone) throw new Error(`${providerID} stream ended without a [DONE] terminator — truncated/dropped connection`)
        break
      }
      const text = decoder.decode(value, { stream: true })
      buffer += text
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? "" // retain the possibly-incomplete trailing line for the next read
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        const jsonStr = line.slice(5).trim()
        if (!jsonStr) continue
        if (jsonStr === "[DONE]") {
          sawDone = true
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(jsonStr)
        } catch {
          continue
        }
        if (providerID === "xai" && isXaiDisguisedOverload(parsed)) throw new Error("xAI disguised overload mid-stream")
        const usage = (parsed as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | undefined)?.usage
        if (usage?.prompt_tokens !== undefined && usage.completion_tokens !== undefined) {
          onUsage({ inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens })
        }
      }
      yield text
    }
  } finally {
    reader.releaseLock()
  }
}

function estimateActualCost(catalog: ModelsDevCatalog, ref: string, usage?: { inputTokens: number; outputTokens: number }): number {
  if (!usage) return 0
  const [providerID, ...rest] = ref.split("/")
  const model = providerID ? catalog[providerID]?.models[rest.join("/")] : undefined
  if (!model) return 0
  return (usage.inputTokens / 1e6) * model.cost.input + (usage.outputTokens / 1e6) * model.cost.output
}

export { JevClassificationError, DEFAULT_CATEGORIES, DEFAULT_FALLBACK_CATEGORY_ID, loadCredentials }
