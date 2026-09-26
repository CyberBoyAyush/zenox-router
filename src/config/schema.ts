import { z } from "zod"

/** "provider/model", e.g. "anthropic/claude-sonnet-5" — same shape OpenCode itself uses. */
export const ModelRefSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/-]+$/, "Model ref must be in 'provider/model' form (see models.dev)")

export const BudgetSchema = z.object({
  dailyUsd: z.number().positive().optional(),
  monthlyUsd: z.number().positive().optional(),
})
export type Budget = z.infer<typeof BudgetSchema>

/**
 * A routing category: a bucket of work that maps to an ordered fallback
 * cascade of models. This is the single source of truth for the Category
 * shape — the built-in DEFAULT_CATEGORIES (src/jev/categories.ts) and any
 * user-defined categories in zenox-router.json both conform to this.
 */
export const CategorySchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_-]+$/, "Category id must be lowercase letters/numbers/-/_ only"),
  name: z.string().min(1),
  /** Sent to Jev verbatim as this option's `choice` criteria text. */
  description: z.string().min(1),
  /** Ordered list of models to try, first candidate first. */
  cascade: z.array(ModelRefSchema).min(1, "A category needs at least one model in its cascade"),
  /**
   * Relative capability/cost rank used only for cross-category fallback when
   * every model in THIS category's own cascade is unusable. Higher = more
   * capable/expensive. Other categories are tried in descending rank order
   * on full exhaustion (see src/routing/cascade.ts).
   */
  capabilityRank: z.number().default(1),
  /** Optional per-category budget, overriding the global budget for this category. */
  budget: BudgetSchema.optional(),
  /**
   * If set, this category's cascade is a live alias for another category's
   * cascade (e.g. "review" inheriting "heavy") instead of its own list — set
   * up in `setup`/`update` as an option so users don't have to hand-populate
   * every category. `cascade` above is ignored when this is set.
   */
  inheritCascadeFrom: z.string().optional(),
})
export type Category = z.infer<typeof CategorySchema>

export const CredentialSourceSchema = z.enum(["opencode-auth", "own-store", "both"])
export type CredentialSource = z.infer<typeof CredentialSourceSchema>

export const RouterConfigSchema = z.object({
  $schema: z.string().optional(),
  categories: z.array(CategorySchema).min(1, "At least one category is required"),
  /** Used when Jev's confidence is below confidenceThreshold, or a message can't be classified. */
  defaultCategoryId: z.string(),
  confidenceThreshold: z.number().min(0).max(1).default(0.5),
  /** Global spend cap; categories may override with their own `budget`. */
  budget: BudgetSchema.optional(),
  /**
   * Where to source API keys for the REAL downstream models a category
   * routes to (not the Jev/OpenRouter key, which always lives in the
   * separate credentials file — see config/credentials.ts).
   *   - "opencode-auth": read-only from OpenCode's own auth.json
   *   - "own-store": zenox-router's own credentials file only
   *   - "both" (default): prefer opencode-auth, fall back to own-store
   */
  credentialSource: CredentialSourceSchema.default("both"),
  /** How much recent conversation context to include in Jev's classification input. */
  recentContextChars: z.number().int().positive().default(600),
  /**
   * Context/output limits for models NOT in the models.dev catalog (custom,
   * self-hosted, or unlisted). The setup wizard requires these to be filled
   * in for any such model added to a cascade, so the aggregate min/max
   * calculations in context/limits.ts stay accurate.
   */
  customModelLimits: z.record(z.string(), z.object({ context: z.number().int().positive(), output: z.number().int().positive() })).default({}),
})
export type RouterConfig = z.infer<typeof RouterConfigSchema>

/** Validates and returns a RouterConfig, or throws with a readable message. */
export function parseRouterConfig(raw: unknown): RouterConfig {
  const result = RouterConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid zenox-router config: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
  }
  const config = result.data
  const ids = new Set(config.categories.map((c) => c.id))
  if (!ids.has(config.defaultCategoryId)) {
    throw new Error(`defaultCategoryId "${config.defaultCategoryId}" does not match any configured category id`)
  }
  for (const c of config.categories) {
    if (c.inheritCascadeFrom && !ids.has(c.inheritCascadeFrom)) {
      throw new Error(`Category "${c.id}" has inheritCascadeFrom "${c.inheritCascadeFrom}" which does not match any category id`)
    }
  }
  return config
}

/** Resolves a category's effective cascade, following inheritCascadeFrom (one level — no chains). */
export function resolveCascade(category: Category, allCategories: Category[]): string[] {
  if (!category.inheritCascadeFrom) return category.cascade
  const target = allCategories.find((c) => c.id === category.inheritCascadeFrom)
  return target ? target.cascade : category.cascade
}
