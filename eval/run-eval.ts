/**
 * Eval harness for the Jev classifier. Run with `bun run eval` (reads
 * OPENROUTER_API_KEY from .env, loaded automatically by Bun). Not shipped
 * in the published package (excluded via package.json "files").
 *
 * Prints: overall accuracy, per-category precision/recall, a confusion
 * matrix, confidence stats, total Jev spend for the run, and a cost-savings
 * estimate for routed vs always-frontier dispatch. Writes the full raw
 * results to eval/results/latest.json (gitignored) for deeper inspection.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { classifyRequest, JevClassificationError } from "../src/jev/classify"
import { DEFAULT_CATEGORIES } from "../src/jev/categories"
import { EVAL_PROMPTS, type EvalPrompt } from "./prompts"
import { STRESS_PROMPTS } from "./prompts-stress"
import { GENERATED_PROMPTS } from "./prompts-generated"
import { GENERATED_PROMPTS_2 } from "./prompts-generated-2"

const ALL_PROMPTS: EvalPrompt[] = [
  ...EVAL_PROMPTS.map((p) => ({ ...p, set: p.set ?? ("core" as const) })),
  ...STRESS_PROMPTS,
  ...GENERATED_PROMPTS,
  ...GENERATED_PROMPTS_2,
]

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set (expected in .env at repo root).")
  process.exit(1)
}

const CATEGORY_IDS = DEFAULT_CATEGORIES.map((c) => c.id)
const CONCURRENCY = 6
const RETRY_DELAYS_MS = [1000, 3000, 8000]

interface RunResult {
  prompt: EvalPrompt
  predicted: string
  confidence: number
  probabilities: Record<string, number>
  costUsd: number
  correct: boolean
  error?: string
}

async function classifyWithRetry(prompt: EvalPrompt): Promise<RunResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await classifyRequest({
        message: prompt.message,
        recentContext: prompt.recentContext,
        categories: DEFAULT_CATEGORIES,
        apiKey: apiKey as string,
      })
      return {
        prompt,
        predicted: result.categoryId,
        confidence: result.confidence,
        probabilities: result.probabilities,
        costUsd: result.usage.costUsd,
        correct: result.categoryId === prompt.expected,
      }
    } catch (err) {
      lastErr = err
      const retryable = err instanceof JevClassificationError && (err.status === undefined || err.status === 429 || err.status >= 500)
      if (!retryable || attempt === RETRY_DELAYS_MS.length) break
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
  }
  return {
    prompt,
    predicted: "ERROR",
    confidence: 0,
    probabilities: {},
    costUsd: 0,
    correct: false,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  }
}

async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

async function main() {
  console.log(
    `Running ${ALL_PROMPTS.length} prompts through Jev (${CATEGORY_IDS.join(", ")}) ` +
      `— core=${EVAL_PROMPTS.length} stress=${STRESS_PROMPTS.length} representative=${GENERATED_PROMPTS.length} fresh=${GENERATED_PROMPTS_2.length}\n`,
  )
  const start = Date.now()
  const results = await runPool(ALL_PROMPTS, CONCURRENCY, classifyWithRetry)
  const elapsedS = ((Date.now() - start) / 1000).toFixed(1)

  const errors = results.filter((r) => r.error)
  const scored = results.filter((r) => !r.error)
  const correct = scored.filter((r) => r.correct)
  const accuracy = scored.length > 0 ? correct.length / scored.length : 0

  // Confusion matrix: expected -> predicted -> count
  const confusion: Record<string, Record<string, number>> = {}
  for (const id of CATEGORY_IDS) confusion[id] = Object.fromEntries(CATEGORY_IDS.map((x) => [x, 0]))
  for (const r of scored) {
    if (!confusion[r.prompt.expected]) confusion[r.prompt.expected] = {}
    confusion[r.prompt.expected]![r.predicted] = (confusion[r.prompt.expected]![r.predicted] ?? 0) + 1
  }

  console.log("=".repeat(72))
  console.log("OVERALL ACCURACY:", pct(accuracy), `(${correct.length}/${scored.length})`, `— ${elapsedS}s, concurrency ${CONCURRENCY}`)
  if (errors.length > 0) console.log(`⚠ ${errors.length} requests errored (excluded from accuracy):`)
  for (const e of errors) console.log(`   [${e.prompt.id}] ${e.error}`)
  console.log("=".repeat(72))

  console.log("\nACCURACY BY SLICE (an aggregate number alone can hide where failures concentrate):\n")
  for (const setName of ["core", "stress", "representative", "fresh"] as const) {
    const slice = scored.filter((r) => r.prompt.set === setName)
    const sliceCorrect = slice.filter((r) => r.correct)
    if (slice.length === 0) continue
    console.log(
      `  ${setName.padEnd(16)} ${pct(sliceCorrect.length / slice.length).padEnd(8)} (${sliceCorrect.length}/${slice.length})`,
    )
  }

  console.log("\nPER-CATEGORY (recall = correctly classified / actually-that-category):\n")
  console.log("category".padEnd(12), "n".padEnd(5), "recall".padEnd(9), "avg confidence (correct)".padEnd(26), "avg confidence (wrong)")
  for (const id of CATEGORY_IDS) {
    const forCategory = scored.filter((r) => r.prompt.expected === id)
    const correctForCategory = forCategory.filter((r) => r.correct)
    const wrongForCategory = forCategory.filter((r) => !r.correct)
    const recall = forCategory.length > 0 ? correctForCategory.length / forCategory.length : NaN
    const avgConfCorrect = avg(correctForCategory.map((r) => r.confidence))
    const avgConfWrong = avg(wrongForCategory.map((r) => r.confidence))
    console.log(
      id.padEnd(12),
      String(forCategory.length).padEnd(5),
      pct(recall).padEnd(9),
      (isNaN(avgConfCorrect) ? "—" : avgConfCorrect.toFixed(2)).padEnd(26),
      isNaN(avgConfWrong) ? "—" : avgConfWrong.toFixed(2),
    )
  }

  console.log("\nCONFUSION MATRIX (rows = expected, cols = predicted):\n")
  const header = "expected \\ predicted".padEnd(22) + CATEGORY_IDS.map((id) => id.padEnd(10)).join("")
  console.log(header)
  for (const expectedId of CATEGORY_IDS) {
    const row = CATEGORY_IDS.map((predId) => String(confusion[expectedId]?.[predId] ?? 0).padEnd(10)).join("")
    console.log(expectedId.padEnd(22) + row)
  }

  console.log("\nMISCLASSIFICATIONS:\n")
  for (const r of scored.filter((r) => !r.correct)) {
    console.log(`  [${r.prompt.id}] expected=${r.prompt.expected} got=${r.predicted} (conf ${r.confidence.toFixed(2)}) :: "${r.prompt.message.slice(0, 80)}${r.prompt.message.length > 80 ? "…" : ""}"`)
  }

  // ── Jev spend for this run ──
  const totalJevCost = scored.reduce((sum, r) => sum + r.costUsd, 0)
  console.log("\n" + "=".repeat(72))
  console.log(`Jev classification cost for this run: $${totalJevCost.toFixed(6)} (${scored.length} requests, avg $${(totalJevCost / Math.max(scored.length, 1)).toFixed(6)}/request)`)

  // ── Cost-savings estimate: routed vs always-frontier ──
  // Representative per-request token assumptions (typical coding-agent turn)
  // and Sept-2026 per-provider list pricing. See docs/implementation.md for
  // the exact figures and caveats — this is an estimate, not a measurement,
  // since real downstream cost depends on actual conversation size.
  const TOKENS = { input: 2000, output: 500 }
  const TIER_COST_PER_M = {
    quick: { input: 0.8, output: 4 }, // e.g. Claude Haiku 4.5
    standard: { input: 3, output: 15 }, // e.g. Claude Sonnet 5
    heavy: { input: 5, output: 25 }, // e.g. Claude Opus 5 / GPT-5.6
    review: { input: 5, output: 25 }, // treated as frontier-tier for precision
  } as const
  const FRONTIER = TIER_COST_PER_M.heavy

  function requestCost(rate: { input: number; output: number }): number {
    return (TOKENS.input / 1e6) * rate.input + (TOKENS.output / 1e6) * rate.output
  }

  const baselineCost = scored.length * requestCost(FRONTIER)
  const routedCost = scored.reduce((sum, r) => {
    const tier = (TIER_COST_PER_M as Record<string, { input: number; output: number }>)[r.predicted] ?? FRONTIER
    return sum + requestCost(tier)
  }, 0)
  const savingsPct = baselineCost > 0 ? (1 - routedCost / baselineCost) * 100 : 0

  console.log(`\nCost-savings estimate (${TOKENS.input} in / ${TOKENS.output} out tokens assumed per request):`)
  console.log(`  Always-frontier baseline: $${baselineCost.toFixed(4)} for ${scored.length} requests`)
  console.log(`  Routed (as classified):   $${routedCost.toFixed(4)} for ${scored.length} requests  (+ $${totalJevCost.toFixed(6)} Jev overhead)`)
  console.log(`  Estimated savings:        ${savingsPct.toFixed(1)}% before Jev overhead, ${(savingsPct - (totalJevCost / baselineCost) * 100).toFixed(1)}% net`)
  console.log("=".repeat(72))

  mkdirSync("eval/results", { recursive: true })
  writeFileSync(
    "eval/results/latest.json",
    JSON.stringify({ accuracy, totalJevCost, baselineCost, routedCost, savingsPct, results }, null, 2),
  )
  console.log("\nFull results written to eval/results/latest.json")
}

function avg(xs: number[]): number {
  if (xs.length === 0) return NaN
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
