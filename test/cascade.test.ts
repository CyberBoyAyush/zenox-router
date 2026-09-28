import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { selectModel, type CascadeDeps } from "../src/routing/cascade"
import { HealthTracker } from "../src/routing/health"
import { SpendLedger } from "../src/routing/budget"
import type { RouterConfig } from "../src/config/schema"
import type { ModelsDevCatalog } from "../src/modelsdev/client"

let tmpDir: string
let healthPath: string
let spendPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "zenox-router-test-"))
  healthPath = join(tmpDir, "health.json")
  spendPath = join(tmpDir, "spend.json")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const CATALOG: ModelsDevCatalog = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    api: "https://api.anthropic.com/v1",
    models: {
      "claude-haiku": { id: "claude-haiku", name: "Haiku", attachment: false, reasoning: false, tool_call: true, limit: { context: 200_000, output: 8_000 }, cost: { input: 0.8, output: 4 } },
      "claude-opus": { id: "claude-opus", name: "Opus", attachment: false, reasoning: true, tool_call: true, limit: { context: 1_000_000, output: 32_000 }, cost: { input: 5, output: 25 } },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-mini": { id: "gpt-mini", name: "GPT Mini", attachment: false, reasoning: false, tool_call: true, limit: { context: 128_000, output: 8_000 }, cost: { input: 0.5, output: 2 } },
    },
  },
}

function config(overrides: Partial<RouterConfig> = {}): RouterConfig {
  return {
    categories: [
      { id: "quick", name: "Quick", description: "d", cascade: ["openai/gpt-mini"], capabilityRank: 0 },
      { id: "heavy", name: "Heavy", description: "d", cascade: ["anthropic/claude-opus", "anthropic/claude-haiku"], capabilityRank: 3 },
    ],
    defaultCategoryId: "quick",
    confidenceThreshold: 0.5,
    credentialSource: "both",
    recentContextChars: 600,
    customModelLimits: {},
    ...overrides,
  }
}

function deps(cfg: RouterConfig): CascadeDeps {
  return { health: new HealthTracker(healthPath), budget: new SpendLedger(spendPath), catalog: CATALOG, manualLimits: {}, config: cfg }
}

describe("selectModel", () => {
  test("picks the first candidate in the cascade when everything is healthy", () => {
    const result = selectModel("heavy", 0, deps(config()))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.selection.ref).toBe("anthropic/claude-opus")
  })

  test("falls through to the next candidate when the first is unhealthy", () => {
    const d = deps(config())
    // Simulate opus being rate-limited with no retry-after (Anthropic spend cap => exhausted, permanent for the provider)
    d.health.recordFailure("anthropic/claude-opus", 429, new Headers(), "{}")
    const result = selectModel("heavy", 0, d)
    expect(result.ok).toBe(true)
    // Both anthropic models are exhausted at the PROVIDER level (spend cap is account-wide) — falls to cross-category
    if (result.ok) expect(result.selection.crossCategoryFallback).toBe(true)
  })

  test("cross-category fallback prefers higher capabilityRank", () => {
    const cfg = config({
      categories: [
        { id: "quick", name: "Quick", description: "d", cascade: ["openai/gpt-mini"], capabilityRank: 0 },
        { id: "standard", name: "Standard", description: "d", cascade: ["anthropic/claude-haiku"], capabilityRank: 1 },
        { id: "heavy", name: "Heavy", description: "d", cascade: ["anthropic/claude-opus"], capabilityRank: 3 },
      ],
      defaultCategoryId: "standard",
    })
    const d = deps(cfg)
    // Exhaust quick's only model (OpenAI classifies quota exhaustion as 429 + a billing error code, not 402)
    d.health.recordFailure("openai/gpt-mini", 429, new Headers(), JSON.stringify({ error: { code: "insufficient_quota" } }))
    const result = selectModel("quick", 0, d)
    expect(result.ok).toBe(true)
    // Should prefer heavy (rank 3) over standard (rank 1) since it tries descending rank order
    if (result.ok) expect(result.selection.categoryId).toBe("heavy")
  })

  test("context-overflow when NO category anywhere has a model that fits", () => {
    const cfg = config({ categories: [{ id: "heavy", name: "Heavy", description: "d", cascade: ["openai/gpt-mini"], capabilityRank: 3 }], defaultCategoryId: "heavy" })
    const d = deps(cfg)
    const hugeTokenCount = 200_000 // exceeds gpt-mini's 128K context, and it's the only model configured
    const result = selectModel("heavy", hugeTokenCount, d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("context-overflow")
  })

  test("context-exhaustion in one category still finds a fitting model in another (regression: used to skip cross-category search entirely on context)", () => {
    const cfg = config({
      categories: [
        { id: "quick", name: "Quick", description: "d", cascade: ["openai/gpt-mini"], capabilityRank: 0 }, // 128K context — too small
        { id: "heavy", name: "Heavy", description: "d", cascade: ["anthropic/claude-opus"], capabilityRank: 3 }, // 1M context — fits
      ],
      defaultCategoryId: "quick",
    })
    const d = deps(cfg)
    const conversationTokens = 300_000 // exceeds gpt-mini's context but well within opus's
    const result = selectModel("quick", conversationTokens, d)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.selection.ref).toBe("anthropic/claude-opus")
      expect(result.selection.crossCategoryFallback).toBe(true)
    }
  })

  test("budget cap excludes a candidate that would exceed it", () => {
    const cfg = config({
      categories: [{ id: "heavy", name: "Heavy", description: "d", cascade: ["anthropic/claude-opus"], capabilityRank: 3, budget: { dailyUsd: 0.00001 } }],
      defaultCategoryId: "heavy",
    })
    const d = deps(cfg)
    const result = selectModel("heavy", 10_000, d) // 10K tokens at opus rates will exceed a $0.00001 cap
    expect(result.ok).toBe(false)
  })

  test("returns all-exhausted when nothing in the whole pool is usable", () => {
    const cfg = config({ categories: [{ id: "only", name: "Only", description: "d", cascade: ["anthropic/claude-opus"], capabilityRank: 1 }], defaultCategoryId: "only" })
    const d = deps(cfg)
    d.health.recordFailure("anthropic/claude-opus", 402, new Headers(), "{}")
    const result = selectModel("only", 0, d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("all-exhausted")
  })

  test("excludeRefs skips a model even if health/budget would otherwise allow it", () => {
    const result = selectModel("heavy", 0, deps(config()), new Set(["anthropic/claude-opus"]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.selection.ref).toBe("anthropic/claude-haiku")
  })
})
