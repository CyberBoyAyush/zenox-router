import { describe, expect, test } from "bun:test"
import { computeAggregateLimits, computeMaxOutputAcrossPool, estimateTokens, modelFitsConversation, usableContextWindow } from "../src/context/limits"
import type { Category } from "../src/config/schema"
import type { ModelsDevCatalog } from "../src/modelsdev/client"

const CATALOG: ModelsDevCatalog = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    models: {
      haiku: { id: "haiku", name: "Haiku", attachment: false, reasoning: false, tool_call: true, limit: { context: 200_000, output: 8_000 }, cost: { input: 0.8, output: 4 } },
      opus: { id: "opus", name: "Opus", attachment: false, reasoning: true, tool_call: true, limit: { context: 1_000_000, output: 32_000 }, cost: { input: 5, output: 25 } },
    },
  },
}

const categories: Category[] = [
  { id: "quick", name: "Quick", description: "d", cascade: ["anthropic/haiku"], capabilityRank: 0 },
  { id: "heavy", name: "Heavy", description: "d", cascade: ["anthropic/opus"], capabilityRank: 3 },
]

describe("computeAggregateLimits", () => {
  test("returns the minimum context/output across the whole pool", () => {
    const limits = computeAggregateLimits(categories, CATALOG)
    expect(limits.context).toBe(200_000) // haiku's smaller context, not opus's larger one
    expect(limits.output).toBe(8_000) // haiku's smaller output
  })

  test("uses manual limits for models not in the catalog", () => {
    const withCustom: Category[] = [...categories, { id: "custom", name: "Custom", description: "d", cascade: ["self-hosted/tiny-model"], capabilityRank: 0 }]
    const limits = computeAggregateLimits(withCustom, CATALOG, { "self-hosted/tiny-model": { context: 4_000, output: 1_000 } })
    expect(limits.context).toBe(4_000)
    expect(limits.output).toBe(1_000)
  })

  test("follows inheritCascadeFrom when computing limits", () => {
    const withInherit: Category[] = [...categories, { id: "review", name: "Review", description: "d", cascade: [], capabilityRank: 3, inheritCascadeFrom: "heavy" }]
    const limits = computeAggregateLimits(withInherit, CATALOG)
    // review inherits heavy's opus cascade, not its own empty one — min should be unaffected (still haiku's 200K)
    expect(limits.context).toBe(200_000)
  })
})

describe("computeMaxOutputAcrossPool", () => {
  test("returns the maximum output across the whole pool", () => {
    expect(computeMaxOutputAcrossPool(categories, CATALOG)).toBe(32_000) // opus's larger output, not haiku's smaller
  })
})

describe("usableContextWindow", () => {
  test("reserves output headroom, capped at the buffer", () => {
    expect(usableContextWindow({ context: 200_000, output: 8_000 })).toBe(192_000)
    // output larger than the 32K buffer only reserves the buffer, matching OpenCode's own compaction math
    expect(usableContextWindow({ context: 1_000_000, output: 128_000 })).toBe(1_000_000 - 32_000)
  })
})

describe("modelFitsConversation", () => {
  test("true when tokens fit within the usable window", () => {
    expect(modelFitsConversation("anthropic/haiku", 100_000, CATALOG)).toBe(true)
  })
  test("false when tokens exceed the usable window", () => {
    expect(modelFitsConversation("anthropic/haiku", 195_000, CATALOG)).toBe(false)
  })
  test("false for an unknown model with no manual override", () => {
    expect(modelFitsConversation("unknown/model", 100, CATALOG)).toBe(false)
  })
})

describe("estimateTokens", () => {
  test("roughly chars/4", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100)
  })
})
