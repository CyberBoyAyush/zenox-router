import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { getHealthStatePath } from "../config/paths"
import { classifyProviderError, parseRateLimitHeaders, type ErrorAction } from "./providers/classify-error"

interface ModelHealth {
  consecutiveFailures: number
  cooldownUntil?: number // epoch ms
  requestsRemaining?: number
  tokensRemaining?: number
  /** When tokensRemaining/requestsRemaining were captured — used to expire a stale snapshot rather than block a model forever once its real window has long since reset. */
  rateLimitRecordedAt?: number
}

/** Rate-limit windows are minutes, not hours — a snapshot older than this is assumed stale and ignored rather than permanently blocking the model. */
const RATE_LIMIT_SNAPSHOT_TTL_MS = 5 * 60 * 1000

interface HealthState {
  models: Record<string, ModelHealth> // "provider/model" -> health
  exhaustedProviders: Record<string, number> // providerID -> epoch ms until considered usable again
}

function emptyState(): HealthState {
  return { models: {}, exhaustedProviders: {} }
}

function providerOf(ref: string): string {
  return ref.split("/")[0] ?? ref
}

/**
 * In-process + disk-persisted health/circuit-breaker tracker. One instance
 * lives for the lifetime of the plugin's proxy server; state is persisted so
 * a known-exhausted provider stays skipped across OpenCode restarts within
 * its cooldown window.
 */
export class HealthTracker {
  private state: HealthState
  private path: string

  constructor(path: string = getHealthStatePath()) {
    this.path = path
    this.state = this.load()
  }

  private load(): HealthState {
    const path = this.path
    if (!existsSync(path)) return emptyState()
    try {
      return { ...emptyState(), ...(JSON.parse(readFileSync(path, "utf-8")) as Partial<HealthState>) }
    } catch {
      return emptyState()
    }
  }

  private persist(): void {
    const path = this.path
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(this.state), "utf-8")
    } catch {
      // Best-effort; health tracking still works in-memory for this process even if disk persist fails.
    }
  }

  isUsable(ref: string, estimatedTokens = 0): boolean {
    const now = Date.now()
    const providerUntil = this.state.exhaustedProviders[providerOf(ref)]
    if (providerUntil && now < providerUntil) return false
    const model = this.state.models[ref]
    if (!model) return true
    if (model.cooldownUntil && now < model.cooldownUntil) return false
    const snapshotFresh = model.rateLimitRecordedAt !== undefined && now - model.rateLimitRecordedAt < RATE_LIMIT_SNAPSHOT_TTL_MS
    if (snapshotFresh && model.tokensRemaining !== undefined && estimatedTokens > 0 && model.tokensRemaining < estimatedTokens) return false
    return true
  }

  recordSuccess(ref: string, headers: Headers): void {
    const snapshot = parseRateLimitHeaders(providerOf(ref), headers)
    const model = this.state.models[ref] ?? { consecutiveFailures: 0 }
    model.consecutiveFailures = 0
    model.cooldownUntil = undefined
    if (snapshot.requestsRemaining !== undefined) model.requestsRemaining = snapshot.requestsRemaining
    if (snapshot.tokensRemaining !== undefined) model.tokensRemaining = snapshot.tokensRemaining
    if (snapshot.requestsRemaining !== undefined || snapshot.tokensRemaining !== undefined) model.rateLimitRecordedAt = Date.now()
    this.state.models[ref] = model
    this.persist()
  }

  /** Classifies the failure and updates state accordingly. Returns the action taken, for the cascade loop to react to. */
  recordFailure(ref: string, status: number, headers: Headers, body: string): ErrorAction {
    const classified = classifyProviderError(providerOf(ref), status, headers, body)
    const model = this.state.models[ref] ?? { consecutiveFailures: 0 }
    model.consecutiveFailures += 1

    if (classified.action === "exhausted") {
      this.state.exhaustedProviders[providerOf(ref)] = Date.now() + (classified.retryAfterMs ?? 60 * 60 * 1000)
    } else if (classified.action === "cooldown" || classified.action === "retry-same") {
      model.cooldownUntil = Date.now() + (classified.retryAfterMs ?? 30_000)
    }
    // fail-fast: no cooldown recorded — this is a config error, not a capacity issue; the SAME model
    // should be allowed to be tried again on the next unrelated request (a bad key won't fix itself by
    // waiting, but we also shouldn't permanently blacklist a model over what might be a one-off bad request).

    this.state.models[ref] = model
    this.persist()
    return classified.action
  }

  /** For `zenox-router status` / debugging. */
  snapshot(): HealthState {
    return this.state
  }
}
