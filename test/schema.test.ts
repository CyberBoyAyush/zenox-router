import { describe, expect, test } from "bun:test"
import { parseRouterConfig, resolveCascade, type Category } from "../src/config/schema"

function baseCategory(overrides: Partial<Category> = {}): Category {
  return { id: "standard", name: "Standard", description: "desc", cascade: ["anthropic/claude-sonnet-5"], capabilityRank: 1, ...overrides }
}

describe("parseRouterConfig", () => {
  test("accepts a minimal valid config", () => {
    const config = parseRouterConfig({ categories: [baseCategory()], defaultCategoryId: "standard" })
    expect(config.categories).toHaveLength(1)
    expect(config.confidenceThreshold).toBe(0.5) // default applied
    expect(config.credentialSource).toBe("both")
  })

  test("rejects a category with an empty cascade", () => {
    expect(() => parseRouterConfig({ categories: [baseCategory({ cascade: [] })], defaultCategoryId: "standard" })).toThrow()
  })

  test("rejects a model ref not in provider/model form", () => {
    expect(() => parseRouterConfig({ categories: [baseCategory({ cascade: ["not-a-valid-ref"] })], defaultCategoryId: "standard" })).toThrow()
  })

  test("rejects defaultCategoryId that doesn't match any category", () => {
    expect(() => parseRouterConfig({ categories: [baseCategory()], defaultCategoryId: "nonexistent" })).toThrow()
  })

  test("rejects inheritCascadeFrom pointing at a nonexistent category", () => {
    const categories = [baseCategory(), baseCategory({ id: "review", inheritCascadeFrom: "nonexistent" })]
    expect(() => parseRouterConfig({ categories, defaultCategoryId: "standard" })).toThrow()
  })

  test("rejects an invalid category id (uppercase/spaces)", () => {
    expect(() => parseRouterConfig({ categories: [baseCategory({ id: "Not Valid" })], defaultCategoryId: "Not Valid" })).toThrow()
  })

  test("accepts a valid inheritCascadeFrom", () => {
    const categories = [baseCategory({ id: "heavy", cascade: ["anthropic/claude-opus-5"] }), baseCategory({ id: "review", cascade: ["anthropic/claude-sonnet-5"], inheritCascadeFrom: "heavy" })]
    const config = parseRouterConfig({ categories, defaultCategoryId: "heavy" })
    expect(config.categories.find((c) => c.id === "review")?.inheritCascadeFrom).toBe("heavy")
  })
})

describe("resolveCascade", () => {
  test("returns the category's own cascade when no inheritance is set", () => {
    const category = baseCategory({ cascade: ["a/x", "a/y"] })
    expect(resolveCascade(category, [category])).toEqual(["a/x", "a/y"])
  })

  test("follows inheritCascadeFrom to another category's cascade", () => {
    const heavy = baseCategory({ id: "heavy", cascade: ["a/opus"] })
    const review = baseCategory({ id: "review", cascade: ["a/should-be-ignored"], inheritCascadeFrom: "heavy" })
    expect(resolveCascade(review, [heavy, review])).toEqual(["a/opus"])
  })

  test("falls back to its own cascade if the inherited-from category is missing", () => {
    const review = baseCategory({ id: "review", cascade: ["a/own"], inheritCascadeFrom: "missing" })
    expect(resolveCascade(review, [review])).toEqual(["a/own"])
  })
})
