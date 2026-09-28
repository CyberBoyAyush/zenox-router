import { describe, expect, test } from "bun:test"
import { toAnthropicRequest, fromAnthropicResponse } from "../src/routing/providers/anthropic-translate"
import type { OpenAIChatRequest } from "../src/server/openai-types"

describe("toAnthropicRequest", () => {
  test("always uses the passed maxOutputTokens, never the request's own max_tokens", () => {
    // Regression test: an earlier version preferred req.max_tokens over the caller-computed clamp,
    // which could send an oversized max_tokens to a small-output model.
    const req: OpenAIChatRequest = { model: "x", messages: [{ role: "user", content: "hi" }], max_tokens: 999_999 }
    const result = toAnthropicRequest(req, 4_000)
    expect(result.max_tokens).toBe(4_000)
  })

  test("separates system messages into the top-level system field", () => {
    const req: OpenAIChatRequest = { model: "x", messages: [{ role: "system", content: "be nice" }, { role: "user", content: "hi" }] }
    const result = toAnthropicRequest(req, 1000)
    expect(result.system).toBe("be nice")
    expect(result.messages).toHaveLength(1)
  })

  test("translates tool-result messages into user tool_result blocks", () => {
    const req: OpenAIChatRequest = {
      model: "x",
      messages: [
        { role: "user", content: "run it" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } }] },
        { role: "tool", content: "file1\nfile2", tool_call_id: "call_1" },
      ],
    }
    const result = toAnthropicRequest(req, 1000)
    const last = result.messages[result.messages.length - 1]!
    expect(last.role).toBe("user")
    expect(last.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "call_1", content: "file1\nfile2" })
  })

  test("translates image_url content parts into Anthropic image blocks", () => {
    const req: OpenAIChatRequest = {
      model: "x",
      messages: [{ role: "user", content: [{ type: "text", text: "what's this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
    }
    const result = toAnthropicRequest(req, 1000)
    const blocks = result.messages[0]!.content
    expect(blocks).toContainEqual({ type: "text", text: "what's this" })
    expect(blocks).toContainEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } })
  })

  test('tool_choice "required" maps to Anthropic {type: "any"}', () => {
    const req: OpenAIChatRequest = {
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "search", parameters: {} } }],
      tool_choice: "required",
    }
    const result = toAnthropicRequest(req, 1000)
    expect(result.tool_choice).toEqual({ type: "any" })
  })

  test('tool_choice "none" drops the tools array entirely (Anthropic has no direct "none")', () => {
    const req: OpenAIChatRequest = {
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "search", parameters: {} } }],
      tool_choice: "none",
    }
    const result = toAnthropicRequest(req, 1000)
    expect(result.tools).toBeUndefined()
    expect(result.tool_choice).toBeUndefined()
  })

  test("a named function tool_choice maps to Anthropic {type: tool, name}", () => {
    const req: OpenAIChatRequest = {
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "search", parameters: {} } }],
      tool_choice: { type: "function", function: { name: "search" } },
    }
    const result = toAnthropicRequest(req, 1000)
    expect(result.tool_choice).toEqual({ type: "tool", name: "search" })
  })

  test("merges consecutive same-role messages (Anthropic requires strict alternation)", () => {
    const req: OpenAIChatRequest = {
      model: "x",
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "a", arguments: "{}" } }] },
        { role: "tool", content: "result1", tool_call_id: "c1" },
        { role: "tool", content: "result2", tool_call_id: "c2" }, // two consecutive tool results
      ],
    }
    const result = toAnthropicRequest(req, 1000)
    // the two tool-result "user" messages should merge into one
    const userMessages = result.messages.filter((m) => m.role === "user")
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]!.content).toHaveLength(2)
  })
})

describe("fromAnthropicResponse", () => {
  test("maps tool_use blocks to OpenAI tool_calls with stringified arguments", () => {
    const resp = fromAnthropicResponse({
      id: "msg_1",
      model: "claude-x",
      content: [{ type: "tool_use", id: "call_1", name: "bash", input: { cmd: "ls" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    expect(resp.choices[0]!.finish_reason).toBe("tool_calls")
    expect(resp.choices[0]!.message.tool_calls).toEqual([{ id: "call_1", type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } }])
  })

  test("maps end_turn to stop and joins text blocks", () => {
    const resp = fromAnthropicResponse({
      id: "msg_2",
      model: "claude-x",
      content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 2 },
    })
    expect(resp.choices[0]!.finish_reason).toBe("stop")
    expect(resp.choices[0]!.message.content).toBe("hello world")
    expect(resp.usage?.total_tokens).toBe(5)
  })
})
