import type { OpenAIChatMessage, OpenAIChatRequest, OpenAIChatResponse } from "../../server/openai-types"

interface AnthropicTextBlock { type: "text"; text: string }
interface AnthropicToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
interface AnthropicToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
interface AnthropicImageBlock { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } }
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock | AnthropicImageBlock

interface AnthropicMessage {
  role: "user" | "assistant"
  content: AnthropicContentBlock[]
}

type AnthropicToolChoice = { type: "auto" } | { type: "any" } | { type: "tool"; name: string }

interface AnthropicRequest {
  model: string
  system?: string
  messages: AnthropicMessage[]
  max_tokens: number
  temperature?: number
  stream?: boolean
  tools?: Array<{ name: string; description?: string; input_schema: unknown }>
  tool_choice?: AnthropicToolChoice
}

interface OpenAIToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

/** Converts an OpenAI-shape chat request (what OpenCode sends us) into Anthropic's Messages API shape. `maxOutputTokens` is authoritative — always used over req.max_tokens, since it's already been clamped to the actually-selected model's real limit by the caller. */
export function toAnthropicRequest(req: OpenAIChatRequest, maxOutputTokens: number): AnthropicRequest {
  const systemParts: string[] = []
  const messages: AnthropicMessage[] = []

  for (const message of req.messages) {
    if (message.role === "system") {
      systemParts.push(contentToPlainText(message.content))
      continue
    }
    if (message.role === "tool") {
      // OpenAI tool-result message -> Anthropic user message carrying a tool_result block.
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.tool_call_id ?? "", content: contentToPlainText(message.content) }],
      })
      continue
    }
    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = []
      const text = contentToPlainText(message.content)
      if (text) blocks.push({ type: "text", text })
      const toolCalls = (message.tool_calls as OpenAIToolCall[] | undefined) ?? []
      for (const call of toolCalls) {
        let input: unknown
        try {
          input = JSON.parse(call.function.arguments)
        } catch {
          // Malformed historical tool-call arguments (e.g. from a truncated prior turn) — surface as an
          // empty object rather than silently pretending the call had no arguments' worth of intent lost;
          // Anthropic requires *some* JSON object here, so this is the least-bad recovery, not a rewrite
          // of the call's meaning (the tool name and id are preserved as-is).
          input = {}
        }
        blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input })
      }
      messages.push({ role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }] })
      continue
    }
    // user — may include image parts alongside text
    messages.push({ role: "user", content: contentToBlocks(message.content) })
  }

  const { tools, toolChoice } = toolsFromOpenAI(req.tools, req.tool_choice)

  return {
    model: req.model,
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: mergeConsecutiveSameRole(messages),
    max_tokens: maxOutputTokens,
    temperature: req.temperature,
    stream: req.stream,
    tools,
    tool_choice: toolChoice,
  }
}

function toolsFromOpenAI(tools: unknown, toolChoice: unknown): { tools: AnthropicRequest["tools"]; toolChoice: AnthropicToolChoice | undefined } {
  if (!Array.isArray(tools)) return { tools: undefined, toolChoice: undefined }
  const out: NonNullable<AnthropicRequest["tools"]> = []
  for (const t of tools) {
    const fn = (t as { function?: { name?: string; description?: string; parameters?: unknown } }).function
    if (!fn?.name) continue
    out.push({ name: fn.name, description: fn.description, input_schema: fn.parameters ?? { type: "object", properties: {} } })
  }
  if (out.length === 0) return { tools: undefined, toolChoice: undefined }

  // OpenAI tool_choice: "auto" | "none" | "required" | { type: "function", function: { name } }
  // Anthropic has no direct "none" — forcing no tool use means omitting `tools` entirely.
  if (toolChoice === "none") return { tools: undefined, toolChoice: undefined }
  if (toolChoice === "required") return { tools: out, toolChoice: { type: "any" } }
  if (toolChoice && typeof toolChoice === "object") {
    const name = (toolChoice as { function?: { name?: string } }).function?.name
    if (name) return { tools: out, toolChoice: { type: "tool", name } }
  }
  return { tools: out, toolChoice: toolChoice === "auto" ? { type: "auto" } : undefined }
}

/** Anthropic requires alternating user/assistant turns; a run of tool-result "user" messages must merge into the preceding user turn. */
function mergeConsecutiveSameRole(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  for (const message of messages) {
    const prev = out[out.length - 1]
    if (prev && prev.role === message.role) {
      prev.content.push(...message.content)
    } else {
      out.push({ role: message.role, content: [...message.content] })
    }
  }
  return out
}

function contentToPlainText(content: OpenAIChatMessage["content"]): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
}

/** Like contentToPlainText, but preserves image_url parts as Anthropic image blocks instead of discarding them. */
function contentToBlocks(content: OpenAIChatMessage["content"]): AnthropicContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }]
  if (!content) return [{ type: "text", text: "" }]
  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      blocks.push({ type: "text", text: part.text })
      continue
    }
    if (part.type === "image_url") {
      const url = (part as { image_url?: { url?: string } }).image_url?.url
      if (!url) continue
      const dataUrlMatch = /^data:([^;]+);base64,(.+)$/.exec(url)
      if (dataUrlMatch) {
        blocks.push({ type: "image", source: { type: "base64", media_type: dataUrlMatch[1]!, data: dataUrlMatch[2]! } })
      } else {
        blocks.push({ type: "image", source: { type: "url", url } })
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }]
}

interface AnthropicResponse {
  id: string
  model: string
  content: AnthropicContentBlock[]
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number }
}

const STOP_REASON_MAP: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  stop_sequence: "stop",
  tool_use: "tool_calls",
}

/** Converts an Anthropic Messages API response back into OpenAI chat-completion shape, so OpenCode sees a normal OpenAI-compatible reply. */
export function fromAnthropicResponse(resp: AnthropicResponse): OpenAIChatResponse {
  const textParts: string[] = []
  const toolCalls: OpenAIToolCall[] = []
  for (const block of resp.content) {
    if (block.type === "text") textParts.push(block.text)
    if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } })
    }
  }
  return {
    id: resp.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textParts.length > 0 ? textParts.join("") : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: resp.stop_reason ? (STOP_REASON_MAP[resp.stop_reason] ?? "stop") : null,
      },
    ],
    usage: {
      prompt_tokens: resp.usage.input_tokens,
      completion_tokens: resp.usage.output_tokens,
      total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
    },
  }
}

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
export const ANTHROPIC_VERSION = "2023-06-01"

export interface DownstreamResult {
  status: number
  headers: Headers
  bodyText: string
}

export async function callAnthropicNonStreaming(apiKey: string, request: AnthropicRequest, baseUrl = ANTHROPIC_API_URL): Promise<DownstreamResult> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ ...request, stream: false }),
  })
  const bodyText = await response.text()
  return { status: response.status, headers: response.headers, bodyText }
}

export function parseAnthropicResponse(bodyText: string): OpenAIChatResponse {
  return fromAnthropicResponse(JSON.parse(bodyText) as AnthropicResponse)
}

/**
 * Starts an Anthropic stream and returns the raw fetch Response WITHOUT
 * consuming it. Callers MUST check `response.ok` (and read `.body`/error
 * text on failure) BEFORE treating the call as a success — this is
 * deliberately a plain async function (not a generator), because calling an
 * async generator function does NOT execute any of its body (not even the
 * fetch) until it is first iterated. An earlier version of this file
 * combined the fetch and the SSE-parsing generator into one async
 * generator function, which meant the caller's try/catch around the call
 * never actually caught anything — the request hadn't been sent yet — and
 * the caller went on to record a false success (health + budget) before
 * any network activity had occurred. Keeping the fetch in its own
 * `async function` (not `async function*`) guarantees it actually runs
 * when awaited.
 */
export async function startAnthropicStream(apiKey: string, request: AnthropicRequest, baseUrl = ANTHROPIC_API_URL): Promise<Response> {
  return fetch(baseUrl, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ ...request, stream: true }),
  })
}

export interface StreamUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * Parses an ALREADY-CONFIRMED-OK Anthropic SSE response body and yields it
 * translated into OpenAI-compatible chat-completion-chunk objects.
 * `onUsage` is invoked once, right before the stream ends, with the final
 * cumulative token usage (captured from `message_start`/`message_delta`
 * events) — this is how the proxy records real spend/health data for
 * streaming responses instead of silently recording zero. A mid-stream
 * `type: "error"` event throws, so the caller's iteration loop can end the
 * response cleanly instead of appending a false `[DONE]`.
 */
export async function* parseAnthropicSSE(response: Response, onUsage?: (usage: StreamUsage) => void): AsyncGenerator<Record<string, unknown>, void, unknown> {
  if (!response.body) throw new Error("Anthropic stream response has no body")

  const id = `chatcmpl-${Date.now()}`
  let model = ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let toolCallIndex = -1
  let currentToolCallId: string | undefined
  let inputTokens = 0
  let outputTokens = 0
  let sawTerminalEvent = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        if (!sawTerminalEvent) throw new Error("Anthropic stream ended before a terminal event (message_delta with stop_reason) was received — truncated/dropped connection")
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        const jsonStr = line.slice(5).trim()
        if (!jsonStr) continue
        let event: Record<string, unknown>
        try {
          event = JSON.parse(jsonStr)
        } catch {
          continue
        }
        const type = event.type as string

        if (type === "error") {
          const message = (event.error as { message?: string } | undefined)?.message ?? "Anthropic stream error event"
          throw new Error(message)
        }

        if (type === "message_start") {
          const msg = event.message as { model?: string; usage?: { input_tokens?: number } } | undefined
          model = msg?.model ?? model
          if (msg?.usage?.input_tokens !== undefined) inputTokens = msg.usage.input_tokens
        } else if (type === "content_block_start") {
          const block = event.content_block as { type: string; id?: string; name?: string } | undefined
          if (block?.type === "tool_use") {
            toolCallIndex++
            currentToolCallId = block.id
            yield chunk(id, model, { tool_calls: [{ index: toolCallIndex, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] })
          }
        } else if (type === "content_block_delta") {
          const delta = event.delta as { type: string; text?: string; partial_json?: string } | undefined
          if (delta?.type === "text_delta" && delta.text) {
            yield chunk(id, model, { content: delta.text })
          } else if (delta?.type === "input_json_delta" && delta.partial_json !== undefined) {
            yield chunk(id, model, { tool_calls: [{ index: toolCallIndex, id: currentToolCallId, type: "function", function: { arguments: delta.partial_json } }] })
          }
        } else if (type === "message_delta") {
          const usage = event.usage as { output_tokens?: number } | undefined
          if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens
          const stopReason = (event.delta as { stop_reason?: string } | undefined)?.stop_reason
          if (stopReason) {
            sawTerminalEvent = true
            onUsage?.({ inputTokens, outputTokens })
            yield chunk(id, model, {}, STOP_REASON_MAP[stopReason] ?? "stop")
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function chunk(id: string, model: string, delta: Record<string, unknown>, finishReason: string | null = null): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}
