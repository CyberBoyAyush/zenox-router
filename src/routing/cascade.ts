import type { Category, RouterConfig } from "../config/schema"
import { resolveCascade } from "../config/schema"
import type { HealthTracker } from "./health"
import type { SpendLedger } from "./budget"
import { modelFitsConversation, type ManualLimits } from "../context/limits"
import { lookupModel, type ModelsDevCatalog } from "../modelsdev/client"

export interface CascadeSelection {
  ref: string
  categoryId: string // the category whose cascade this model actually came from — differs from the classified category on cross-category fallback
  crossCategoryFallback: boolean
}

export type CascadeResult = { ok: true; selection: CascadeSelection } | { ok: false; error: "context-overflow" | "all-exhausted" }

export interface CascadeDeps {
  health: HealthTracker
  budget: SpendLedger
  catalog: ModelsDevCatalog
  manualLimits: ManualLimits
  config: RouterConfig
}

type TryResult = { kind: "found"; ref: string } | { kind: "context-exhausted" } | { kind: "health-exhausted" }

function estimateRequestCost(costInput: number, costOutput: number, inputTokens: number, assumedOutputTokens = 1000): number {
  return (inputTokens / 1e6) * costInput + (assumedOutputTokens / 1e6) * costOutput
}

function tryCategory(category: Category, conversationTokens: number, deps: CascadeDeps, excludeRefs: Set<string>): TryResult {
  const { config, health, budget, catalog, manualLimits } = deps
  const cascade = resolveCascade(category, config.categories)
  let sawHealthyButContextTooSmall = false

  for (const ref of cascade) {
    if (excludeRefs.has(ref)) continue
    const healthOk = health.isUsable(ref, conversationTokens)
    if (!healthOk) continue

    const model = lookupModel(catalog, ref)
    const estimatedCost = model ? estimateRequestCost(model.costInput, model.costOutput, conversationTokens) : 0
    const budgetOk = !budget.wouldExceedBudget(category.id, estimatedCost, config.budget, category.budget)
    if (!budgetOk) continue

    const contextOk = conversationTokens === 0 || modelFitsConversation(ref, conversationTokens, catalog, manualLimits)
    if (contextOk) return { kind: "found", ref }
    sawHealthyButContextTooSmall = true
  }

  return sawHealthyButContextTooSmall ? { kind: "context-exhausted" } : { kind: "health-exhausted" }
}

/**
 * Picks the first usable model for `categoryId`. If the category's own
 * cascade is exhausted (for health/budget reasons OR because nothing in it
 * fits the conversation's size), falls through to OTHER categories in
 * descending capabilityRank order (prefer an equally-or-more-capable
 * alternative before downgrading — see Category.capabilityRank docs)
 * looking for ANY usable+affordable+fitting model in the whole configured
 * pool. Nothing guarantees a lower-rank category has a smaller context
 * window than the classified one (rank tracks capability/cost, not context
 * size), so a context-exhausted category still searches every other
 * category before giving up — it only skips straight to declaring
 * "context-overflow" once NO category anywhere has a fitting candidate.
 * "context-overflow" (vs "all-exhausted") is returned when at least one
 * category had a healthy, affordable candidate that was simply too big for
 * the conversation, so the caller can translate it into OpenCode's
 * recognized overflow error shape and trigger its own compaction+retry.
 */
export function selectModel(categoryId: string, conversationTokens: number, deps: CascadeDeps, excludeRefs: Set<string> = new Set()): CascadeResult {
  const category = deps.config.categories.find((c) => c.id === categoryId)
  if (!category) return { ok: false, error: "all-exhausted" }

  const others = deps.config.categories.filter((c) => c.id !== category.id).sort((a, b) => b.capabilityRank - a.capabilityRank)
  const searchOrder = [category, ...others]

  let sawContextExhaustion = false
  for (const candidate of searchOrder) {
    const result = tryCategory(candidate, conversationTokens, deps, excludeRefs)
    if (result.kind === "found") {
      return { ok: true, selection: { ref: result.ref, categoryId: candidate.id, crossCategoryFallback: candidate.id !== category.id } }
    }
    if (result.kind === "context-exhausted") sawContextExhaustion = true
  }

  return { ok: false, error: sawContextExhaustion ? "context-overflow" : "all-exhausted" }
}
