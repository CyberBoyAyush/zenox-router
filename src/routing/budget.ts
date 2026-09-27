import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { getSpendLedgerPath } from "../config/paths"
import type { Budget } from "../config/schema"

interface SpendEntry {
  timestamp: number
  categoryId: string
  costUsd: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_MS = 30 * DAY_MS
const PRUNE_AFTER_MS = 31 * DAY_MS

function load(path: string): SpendEntry[] {
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SpendEntry[]
  } catch {
    return []
  }
}

function save(path: string, entries: SpendEntry[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(entries), "utf-8")
  } catch {
    // Best-effort — budget enforcement degrades to "no cap known" if disk writes fail, never blocks requests.
  }
}

/** Local, append-only spend ledger used purely for the "do we skip this cascade candidate for budget reasons" check. Not a billing system of record. */
export class SpendLedger {
  private entries: SpendEntry[]
  private path: string

  constructor(path: string = getSpendLedgerPath()) {
    this.path = path
    this.entries = load(this.path)
  }

  record(categoryId: string, costUsd: number): void {
    const now = Date.now()
    this.entries.push({ timestamp: now, categoryId, costUsd })
    this.entries = this.entries.filter((e) => now - e.timestamp < PRUNE_AFTER_MS)
    save(this.path, this.entries)
  }

  private sumSince(categoryId: string | undefined, sinceMs: number): number {
    const now = Date.now()
    return this.entries
      .filter((e) => now - e.timestamp < sinceMs && (categoryId === undefined || e.categoryId === categoryId))
      .reduce((sum, e) => sum + e.costUsd, 0)
  }

  /**
   * True if recording `estimatedCostUsd` more spend against `categoryId` would
   * exceed either its own budget or the global budget (whichever is tighter).
   * `undefined` budgets mean "no cap" and never block.
   */
  wouldExceedBudget(categoryId: string, estimatedCostUsd: number, globalBudget?: Budget, categoryBudget?: Budget): boolean {
    if (categoryBudget?.dailyUsd !== undefined && this.sumSince(categoryId, DAY_MS) + estimatedCostUsd > categoryBudget.dailyUsd) return true
    if (categoryBudget?.monthlyUsd !== undefined && this.sumSince(categoryId, MONTH_MS) + estimatedCostUsd > categoryBudget.monthlyUsd) return true
    if (globalBudget?.dailyUsd !== undefined && this.sumSince(undefined, DAY_MS) + estimatedCostUsd > globalBudget.dailyUsd) return true
    if (globalBudget?.monthlyUsd !== undefined && this.sumSince(undefined, MONTH_MS) + estimatedCostUsd > globalBudget.monthlyUsd) return true
    return false
  }

  dailyTotal(categoryId?: string): number {
    return this.sumSince(categoryId, DAY_MS)
  }

  monthlyTotal(categoryId?: string): number {
    return this.sumSince(categoryId, MONTH_MS)
  }
}
