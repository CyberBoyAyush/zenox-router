import { describe, expect, test } from "bun:test"
import { parseAnthropicSSE } from "../src/routing/providers/anthropic-translate"

function sseResponse(rawChunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of rawChunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream)
}

const MESSAGE_START = (usage = { input_tokens: 100 }) => `data: ${JSON.stringify({ type: "message_start", message: { model: "claude-x", usage } })}\n\n`
const TEXT_DELTA = (text: string) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`
const MESSAGE_DELTA_STOP = (output_tokens = 5) => `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens } })}\n\n`

describe("parseAnthropicSSE", () => {
  test("yields text deltas and reports usage exactly once at the terminal event", async () => {
    const response = sseResponse([MESSAGE_START(), TEXT_DELTA("hello"), MESSAGE_DELTA_STOP(7)])
    const usageCalls: Array<{ inputTokens: number; outputTokens: number }> = []
    const chunks: Record<string, unknown>[] = []
    for await (const c of parseAnthropicSSE(response, (u) => usageCalls.push(u))) chunks.push(c)
    expect(usageCalls).toHaveLength(1)
    expect(usageCalls[0]).toEqual({ inputTokens: 100, outputTokens: 7 })
    expect(chunks.some((c) => JSON.stringify(c).includes("hello"))).toBe(true)
  })

  test("throws if the stream ends without a terminal message_delta (truncated connection), instead of silently succeeding", async () => {
    const response = sseResponse([MESSAGE_START(), TEXT_DELTA("partial")]) // no MESSAGE_DELTA_STOP — connection just ends
    const iterate = async () => {
      const out = []
      for await (const c of parseAnthropicSSE(response)) out.push(c)
      return out
    }
    await expect(iterate()).rejects.toThrow(/truncated|dropped/i)
  })

  test("throws on a mid-stream error event rather than continuing as if nothing happened", async () => {
    const response = sseResponse([MESSAGE_START(), `data: ${JSON.stringify({ type: "error", error: { message: "overloaded" } })}\n\n`])
    const iterate = async () => {
      const out = []
      for await (const c of parseAnthropicSSE(response)) out.push(c)
      return out
    }
    await expect(iterate()).rejects.toThrow("overloaded")
  })

  test("a JSON line split exactly at the closing brace (no trailing newline yet) is not double-counted when the newline arrives in the next chunk", async () => {
    // Regression test for the chunk-boundary double-parse bug: earlier code in relayUpstreamSSE (the
    // OpenAI-compatible path) parsed whatever was in the buffer on every read, including a
    // complete-looking JSON payload that hadn't been newline-terminated by the transport yet, then
    // parsed (and billed) the SAME line again once the newline arrived in a later chunk. This test
    // exercises the equivalent split for the Anthropic path's message_delta event, split at the worst
    // possible byte boundary — right after the closing brace, before the trailing "\n\n".
    const full = MESSAGE_DELTA_STOP(42)
    const splitPoint = full.indexOf("}}\n\n") + 2 // right after the JSON's closing brace, before "\n\n"
    const response = sseResponse([MESSAGE_START(), TEXT_DELTA("x"), full.slice(0, splitPoint), full.slice(splitPoint)])
    const usageCalls: Array<{ inputTokens: number; outputTokens: number }> = []
    for await (const _c of parseAnthropicSSE(response, (u) => usageCalls.push(u))) {
      /* drain */
    }
    expect(usageCalls).toHaveLength(1)
    expect(usageCalls[0]!.outputTokens).toBe(42)
  })
})
