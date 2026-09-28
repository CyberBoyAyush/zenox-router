import { describe, expect, test } from "bun:test"
import { classifyProviderError, isXaiDisguisedOverload, parseRateLimitHeaders } from "../src/routing/providers/classify-error"

describe("classifyProviderError — anthropic", () => {
  test("429 with retry-after is a transient rate limit (retry-same)", () => {
    const result = classifyProviderError("anthropic", 429, new Headers({ "retry-after": "5" }), "{}")
    expect(result.action).toBe("retry-same")
    expect(result.retryAfterMs).toBe(5000)
  })

  test("429 without retry-after is a spend cap (exhausted)", () => {
    const result = classifyProviderError("anthropic", 429, new Headers(), "{}")
    expect(result.action).toBe("exhausted")
  })

  test("400 with credit balance message is exhausted, not fail-fast", () => {
    const body = JSON.stringify({ error: { message: "Your credit balance is too low to access the Claude API." } })
    const result = classifyProviderError("anthropic", 400, new Headers(), body)
    expect(result.action).toBe("exhausted")
  })

  test("400 with an unrelated message is fail-fast", () => {
    const body = JSON.stringify({ error: { message: "invalid request: missing field 'model'" } })
    const result = classifyProviderError("anthropic", 400, new Headers(), body)
    expect(result.action).toBe("fail-fast")
  })

  test("529 overloaded is a cooldown", () => {
    expect(classifyProviderError("anthropic", 529, new Headers(), "{}").action).toBe("cooldown")
  })

  test("401 is fail-fast", () => {
    expect(classifyProviderError("anthropic", 401, new Headers(), "{}").action).toBe("fail-fast")
  })
})

describe("classifyProviderError — openai", () => {
  test("429 with a billing code is exhausted", () => {
    const body = JSON.stringify({ error: { code: "insufficient_quota" } })
    expect(classifyProviderError("openai", 429, new Headers(), body).action).toBe("exhausted")
  })

  test("429 with rate_limit_exceeded code is retry-same", () => {
    const body = JSON.stringify({ error: { code: "rate_limit_exceeded" } })
    expect(classifyProviderError("openai", 429, new Headers(), body).action).toBe("retry-same")
  })

  test("503 is a cooldown", () => {
    expect(classifyProviderError("openai", 503, new Headers(), "{}").action).toBe("cooldown")
  })
})

describe("classifyProviderError — xai", () => {
  test("disguised overload body is detected", () => {
    expect(isXaiDisguisedOverload({ code: "The service is currently unavailable" })).toBe(true)
    expect(isXaiDisguisedOverload({ code: "invalid_value" })).toBe(false)
    expect(isXaiDisguisedOverload("not an object")).toBe(false)
  })

  test("402 is exhausted", () => {
    expect(classifyProviderError("xai", 402, new Headers(), "{}").action).toBe("exhausted")
  })
})

describe("classifyProviderError — openrouter", () => {
  test("402 is exhausted", () => {
    expect(classifyProviderError("openrouter", 402, new Headers(), "{}").action).toBe("exhausted")
  })
  test("429 is retry-same", () => {
    expect(classifyProviderError("openrouter", 429, new Headers(), "{}").action).toBe("retry-same")
  })
})

describe("classifyProviderError — generic fallback (unlisted provider)", () => {
  test("still handles standard HTTP semantics", () => {
    expect(classifyProviderError("some-random-provider", 401, new Headers(), "{}").action).toBe("fail-fast")
    expect(classifyProviderError("some-random-provider", 402, new Headers(), "{}").action).toBe("exhausted")
    expect(classifyProviderError("some-random-provider", 500, new Headers(), "{}").action).toBe("cooldown")
    expect(classifyProviderError("some-random-provider", 429, new Headers({ "retry-after": "2" }), "{}").action).toBe("retry-same")
  })
})

describe("parseRateLimitHeaders", () => {
  test("parses anthropic headers", () => {
    const headers = new Headers({ "anthropic-ratelimit-requests-remaining": "10", "anthropic-ratelimit-tokens-remaining": "5000" })
    const snapshot = parseRateLimitHeaders("anthropic", headers)
    expect(snapshot.requestsRemaining).toBe(10)
    expect(snapshot.tokensRemaining).toBe(5000)
  })

  test("parses openai/xai headers", () => {
    const headers = new Headers({ "x-ratelimit-remaining-requests": "59", "x-ratelimit-remaining-tokens": "149984" })
    expect(parseRateLimitHeaders("openai", headers).requestsRemaining).toBe(59)
    expect(parseRateLimitHeaders("xai", headers).tokensRemaining).toBe(149984)
  })

  test("openrouter has no success-response rate-limit headers", () => {
    expect(parseRateLimitHeaders("openrouter", new Headers()).requestsRemaining).toBeUndefined()
  })
})
