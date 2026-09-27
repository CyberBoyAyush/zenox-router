import type { OpenAIChatRequest } from "../../server/openai-types"

export interface DownstreamResult {
  status: number
  headers: Headers
  bodyText: string
}

/**
 * Forwards an already-OpenAI-shape request (what OpenCode sends us) to a
 * real OpenAI-compatible provider (OpenAI itself, xAI, OpenRouter, and the
 * large majority of models.dev providers, which are themselves
 * `@ai-sdk/openai-compatible` under the hood) — no translation needed
 * beyond the real API key, base URL, and model ID.
 */
export async function callOpenAICompatible(baseUrl: string, apiKey: string, request: OpenAIChatRequest): Promise<DownstreamResult> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: false }),
  })
  const bodyText = await response.text()
  return { status: response.status, headers: response.headers, bodyText }
}

/** Streaming variant — returns the raw upstream Response for byte-for-byte SSE relay (already OpenAI-shape, no translation needed). */
export async function callOpenAICompatibleStreamStart(baseUrl: string, apiKey: string, request: OpenAIChatRequest): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: true }),
  })
}
