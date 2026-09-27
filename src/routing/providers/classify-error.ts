/**
 * Per-provider HTTP response classification, per the researched behavior of
 * Anthropic/OpenAI/xAI/OpenRouter (see docs/implementation.md for the full
 * reference table and citations). Any provider not specifically listed here
 * falls through to a conservative generic classifier that still handles the
 * well-established HTTP semantics (401/403/400 = config error, 429 = rate
 * limit, 402/5xx = exhausted/overloaded).
 */

export type ErrorAction =
  | "retry-same" // transient; retry the SAME model once before falling through the cascade
  | "cooldown" // temporarily unusable; skip for a cooldown window, cascade to next
  | "exhausted" // billing/quota exhausted; skip for longer, cascade to next (and eligible for cross-category fallback)
  | "fail-fast" // configuration error (bad/missing key, malformed request); do not retry or cascade

export interface ClassifiedError {
  action: ErrorAction
  /** ms to wait before the same model is considered usable again, when action is retry-same/cooldown/exhausted. */
  retryAfterMs?: number
  reason: string
}

const DEFAULT_COOLDOWN_MS = 30_000
const DEFAULT_EXHAUSTED_MS = 60 * 60 * 1000 // 1 hour — conservative guess when no reset time is known

function parseRetryAfterHeader(headers: Headers): number | undefined {
  const raw = headers.get("retry-after")
  if (!raw) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
}

function safeJson(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function classifyAnthropic(status: number, headers: Headers, body: string): ClassifiedError {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers)
    // Presence of retry-after = true rate limit; absence = spend-cap 429 (never retries).
    return retryAfterMs !== undefined
      ? { action: "retry-same", retryAfterMs, reason: "Anthropic rate limit (retry-after present)" }
      : { action: "exhausted", retryAfterMs: DEFAULT_EXHAUSTED_MS, reason: "Anthropic spend cap (429 with no retry-after)" }
  }
  if (status === 400) {
    const json = safeJson(body)
    const message = typeof json?.error === "object" && json.error !== null ? String((json.error as Record<string, unknown>).message ?? "") : ""
    if (/credit balance|spend limit/i.test(message)) {
      return { action: "exhausted", retryAfterMs: DEFAULT_EXHAUSTED_MS, reason: "Anthropic credit balance/spend limit (400)" }
    }
    return { action: "fail-fast", reason: "Anthropic 400 (malformed request)" }
  }
  if (status === 402) return { action: "exhausted", retryAfterMs: DEFAULT_EXHAUSTED_MS, reason: "Anthropic billing error (402)" }
  if (status === 529) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: "Anthropic overloaded (529)" }
  if (status >= 500) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: `Anthropic server error (${status})` }
  if (status === 401 || status === 403) return { action: "fail-fast", reason: "Anthropic auth/permission error" }
  return { action: "fail-fast", reason: `Anthropic unclassified status ${status}` }
}

function classifyOpenAI(status: number, _headers: Headers, body: string): ClassifiedError {
  if (status === 429) {
    const json = safeJson(body)
    const errorObj = typeof json?.error === "object" && json.error !== null ? (json.error as Record<string, unknown>) : undefined
    const code = typeof errorObj?.code === "string" ? errorObj.code : undefined
    const BILLING_CODES = new Set([
      "credit_balance_exhausted",
      "organization_spend_limit_exceeded",
      "project_spend_limit_exceeded",
      "organization_usage_limit_exceeded",
      "insufficient_quota",
    ])
    if (code && BILLING_CODES.has(code)) {
      return { action: "exhausted", retryAfterMs: DEFAULT_EXHAUSTED_MS, reason: `OpenAI billing exhausted (${code})` }
    }
    return { action: "retry-same", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: `OpenAI rate limit (${code ?? "rate_limit_exceeded"})` }
  }
  if (status === 503) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: "OpenAI server overloaded (503)" }
  if (status >= 500) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: `OpenAI server error (${status})` }
  if (status === 401 || status === 403) return { action: "fail-fast", reason: "OpenAI auth/permission error" }
  if (status === 400) return { action: "fail-fast", reason: "OpenAI 400 (malformed request)" }
  return { action: "fail-fast", reason: `OpenAI unclassified status ${status}` }
}

/** xAI sometimes returns an overload condition as HTTP 200 with an error-shaped body — callers must check this before classifyXai runs on a "success". */
export function isXaiDisguisedOverload(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false
  const code = (body as Record<string, unknown>).code
  return typeof code === "string" && /unavailable|overloaded|timed out/i.test(code)
}

function classifyXai(status: number, headers: Headers, _body: string): ClassifiedError {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers) ?? DEFAULT_COOLDOWN_MS
    return { action: "retry-same", retryAfterMs, reason: "xAI rate limit" }
  }
  if (status === 402 || status === 403) return { action: "exhausted", retryAfterMs: DEFAULT_EXHAUSTED_MS, reason: `xAI billing/blocked (${status})` }
  if (status === 503) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: "xAI overloaded (503)" }
  if (status >= 500) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: `xAI server error (${status})` }
  if (status === 401) return { action: "fail-fast", reason: "xAI auth error" }
  if (status === 400 || status === 422) return { action: "fail-fast", reason: "xAI bad request" }
  return { action: "fail-fast", reason: `xAI unclassified status ${status}` }
}

function classifyOpenRouter(status: number, headers: Headers, body: string): ClassifiedError {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers) ?? DEFAULT_COOLDOWN_MS
    return { action: "retry-same", retryAfterMs, reason: "OpenRouter rate limit" }
  }
  if (status === 402) return { action: "exhausted", retryAfterMs: DEFAULT_EXHAUSTED_MS, reason: "OpenRouter insufficient credits" }
  if (status >= 500) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: `OpenRouter upstream error (${status})` }
  if (status === 401) return { action: "fail-fast", reason: "OpenRouter auth error" }
  if (status === 400) return { action: "fail-fast", reason: "OpenRouter bad request" }
  void body
  return { action: "fail-fast", reason: `OpenRouter unclassified status ${status}` }
}

function classifyGeneric(status: number, headers: Headers): ClassifiedError {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers)
    return retryAfterMs !== undefined
      ? { action: "retry-same", retryAfterMs, reason: "Rate limited (retry-after present)" }
      : { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: "Rate limited (no retry-after)" }
  }
  if (status === 402) return { action: "exhausted", retryAfterMs: DEFAULT_EXHAUSTED_MS, reason: "Payment/credits required (402)" }
  if (status >= 500) return { action: "cooldown", retryAfterMs: DEFAULT_COOLDOWN_MS, reason: `Server error (${status})` }
  if (status === 401 || status === 403) return { action: "fail-fast", reason: "Auth/permission error" }
  if (status === 400 || status === 422) return { action: "fail-fast", reason: "Bad request" }
  return { action: "fail-fast", reason: `Unclassified status ${status}` }
}

const CLASSIFIERS: Record<string, (status: number, headers: Headers, body: string) => ClassifiedError> = {
  anthropic: classifyAnthropic,
  openai: classifyOpenAI,
  xai: classifyXai,
  openrouter: classifyOpenRouter,
}

export function classifyProviderError(providerID: string, status: number, headers: Headers, body: string): ClassifiedError {
  const classifier = CLASSIFIERS[providerID]
  return classifier ? classifier(status, headers, body) : classifyGeneric(status, headers)
}

export interface RateLimitSnapshot {
  requestsRemaining?: number
  tokensRemaining?: number
  resetAt?: Date
}

/** Parses success-response rate-limit headers, where the provider exposes them (Anthropic/OpenAI/xAI; OpenRouter does not on success). */
export function parseRateLimitHeaders(providerID: string, headers: Headers): RateLimitSnapshot {
  if (providerID === "anthropic") {
    const req = headers.get("anthropic-ratelimit-requests-remaining")
    const tok = headers.get("anthropic-ratelimit-tokens-remaining")
    const reset = headers.get("anthropic-ratelimit-requests-reset")
    return {
      requestsRemaining: req ? Number(req) : undefined,
      tokensRemaining: tok ? Number(tok) : undefined,
      resetAt: reset ? new Date(reset) : undefined,
    }
  }
  if (providerID === "openai" || providerID === "xai") {
    const req = headers.get("x-ratelimit-remaining-requests")
    const tok = headers.get("x-ratelimit-remaining-tokens")
    return { requestsRemaining: req ? Number(req) : undefined, tokensRemaining: tok ? Number(tok) : undefined }
  }
  return {}
}
