/** Minimal OpenAI chat-completions shapes — only the fields zenox-router actually reads/writes. */

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }> | null
  name?: string
  tool_calls?: unknown
  tool_call_id?: string
}

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIChatMessage[]
  max_tokens?: number
  temperature?: number
  stream?: boolean
  tools?: unknown
  tool_choice?: unknown
  [key: string]: unknown
}

export interface OpenAIChatChoice {
  index: number
  message: { role: "assistant"; content: string | null; tool_calls?: unknown }
  finish_reason: string | null
}

export interface OpenAIChatResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: OpenAIChatChoice[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface OpenAIErrorBody {
  error: { message: string; type?: string; code?: string | null }
}

export function openAIErrorBody(message: string, code?: string): OpenAIErrorBody {
  return { error: { message, code } }
}

/** The shape OpenCode's overflow-recovery classifier recognizes (see docs/implementation.md). */
export function contextLengthExceededBody(message: string): OpenAIErrorBody {
  return { error: { message, code: "context_length_exceeded", type: "invalid_request_error" } }
}

export function extractLatestUserText(messages: OpenAIChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== "user") continue
    return contentToText(message.content)
  }
  return ""
}

export function contentToText(content: OpenAIChatMessage["content"]): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
}

/** A short digest of recent turns for Jev's `recent_context`, bounded to `maxChars`. */
export function buildRecentContext(messages: OpenAIChatMessage[], maxChars: number): string {
  const turns: string[] = []
  // Walk backwards, skip the very latest user message (that's the thing being classified), collect prior turns.
  let skippedLatestUser = false
  for (let i = messages.length - 1; i >= 0 && turns.join("\n").length < maxChars; i--) {
    const message = messages[i]
    if (!message || message.role === "system") continue
    if (message.role === "user" && !skippedLatestUser) {
      skippedLatestUser = true
      continue
    }
    const text = contentToText(message.content).trim()
    if (!text) continue
    turns.unshift(`${message.role}: ${text.slice(0, 300)}`)
  }
  return turns.join("\n").slice(-maxChars)
}

export function estimateRequestChars(messages: OpenAIChatMessage[]): number {
  return messages.reduce((sum, m) => sum + contentToText(m.content).length, 0)
}
