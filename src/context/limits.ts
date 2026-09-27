import type { Category } from "../config/schema"
import { resolveCascade } from "../config/schema"
import { lookupModel, type ModelsDevCatalog } from "../modelsdev/client"

export interface ModelLimits {
  context: number
  output: number
}

/** Manual overrides for models.dev misses — one exists for every cascade entry not in the catalog (setup enforces this). */
export type ManualLimits = Record<string, ModelLimits>

function limitsFor(ref: string, catalog: ModelsDevCatalog, manual: ManualLimits): ModelLimits | undefined {
  const known = lookupModel(catalog, ref)
  if (known) return { context: known.context, output: known.output }
  return manual[ref]
}

/**
 * The context/output limits to declare on the registered "Zenox Router"
 * model: the true minimum across every model in every category's (resolved)
 * cascade. This is a SOFT signal to OpenCode (drives when its own
 * auto-compaction fires — see docs/implementation.md), not a hard cap on
 * what we can actually send downstream; the real per-request call always
 * uses the ACTUAL selected model's real limits via chat.params.
 *
 * Recomputed on every `setup`/`update` run, never hardcoded.
 */
export function computeAggregateLimits(categories: Category[], catalog: ModelsDevCatalog, manual: ManualLimits = {}): ModelLimits {
  let minContext = Infinity
  let minOutput = Infinity
  for (const category of categories) {
    const cascade = resolveCascade(category, categories)
    for (const ref of cascade) {
      const limits = limitsFor(ref, catalog, manual)
      if (!limits) continue // setup should prevent this, but never let one bad ref break the whole calc
      minContext = Math.min(minContext, limits.context)
      minOutput = Math.min(minOutput, limits.output)
    }
  }
  if (!Number.isFinite(minContext) || !Number.isFinite(minOutput)) {
    // No resolvable cascade entries at all — should not happen post-setup, but a safe conservative fallback beats crashing.
    return { context: 128_000, output: 8_000 }
  }
  return { context: minContext, output: minOutput }
}

/**
 * The LARGEST output limit across the whole configured pool — used as a
 * static `chat.params` maxOutputTokens override on V1 (see plugin/v1.ts).
 * V1's `dev` branch silently caps outbound max_tokens at 32,000 regardless
 * of a model's declared limit.output (confirmed bug; already fixed on the
 * v2 branch, so V2 needs no equivalent override). Setting this generously
 * high just ensures OpenCode doesn't clamp the OUTGOING request below what
 * some pool model could actually use; the proxy's own downstream call
 * always re-clamps to whichever specific model is actually selected, so
 * this can't cause an over-large request to reach a small-output model.
 */
export function computeMaxOutputAcrossPool(categories: Category[], catalog: ModelsDevCatalog, manual: ManualLimits = {}): number {
  let max = 0
  for (const category of categories) {
    for (const ref of resolveCascade(category, categories)) {
      const limits = limitsFor(ref, catalog, manual)
      if (limits) max = Math.max(max, limits.output)
    }
  }
  return max > 0 ? max : 32_000
}

/**
 * Cheap, tokenizer-free estimate (chars/4, a standard rough heuristic across
 * English/code text) used only for pre-flight "does this candidate's context
 * window fit the conversation so far" cascade filtering — not for exact
 * accounting. Real token counts come from each provider's own usage response.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Reserve room for the response itself, mirroring OpenCode's own compaction-trigger math (context - min(output, buffer)). */
export function usableContextWindow(limits: ModelLimits, outputReserveCap = 32_000): number {
  return Math.max(0, limits.context - Math.min(limits.output, outputReserveCap))
}

export function modelFitsConversation(ref: string, estimatedTokens: number, catalog: ModelsDevCatalog, manual: ManualLimits = {}): boolean {
  const limits = limitsFor(ref, catalog, manual)
  if (!limits) return false // unknown model with no manual override — treat as not-fitting rather than guessing
  return estimatedTokens <= usableContextWindow(limits)
}

export function realLimitsFor(ref: string, catalog: ModelsDevCatalog, manual: ManualLimits = {}): ModelLimits | undefined {
  return limitsFor(ref, catalog, manual)
}
