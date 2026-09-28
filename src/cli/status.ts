import pc from "picocolors"
import { loadRouterConfig } from "../config/store"
import { loadCredentials } from "../config/credentials"
import { HealthTracker } from "../routing/health"
import { SpendLedger } from "../routing/budget"
import { getGlobalRouterConfigPath, getCredentialsPath } from "../config/paths"

export function runStatus(): void {
  const config = loadRouterConfig(process.cwd())
  const creds = loadCredentials()

  console.log(pc.bold("zenox-router status\n"))
  console.log(`Config file:      ${getGlobalRouterConfigPath()}`)
  console.log(`Credentials file: ${getCredentialsPath()}`)
  console.log(`Jev key set:      ${creds.jevApiKey ? pc.green("yes") : pc.red("no")}`)

  if (!config) {
    console.log(pc.yellow("\nNo config found — run `zenox-router setup`."))
    return
  }

  console.log(`\nCategories (default: ${pc.bold(config.defaultCategoryId)}):`)
  for (const c of config.categories) {
    console.log(`  ${pc.bold(c.name)} [${c.id}] rank=${c.capabilityRank}`)
    console.log(`    cascade: ${c.cascade.join(" \u2192 ")}`)
  }

  const health = new HealthTracker()
  const snapshot = health.snapshot()
  const exhausted = Object.entries(snapshot.exhaustedProviders).filter(([, until]) => until > Date.now())
  console.log(`\nHealth: ${exhausted.length === 0 ? pc.green("all providers healthy") : pc.yellow(`${exhausted.length} provider(s) currently exhausted`)}`)
  for (const [providerId, until] of exhausted) {
    console.log(`  ${providerId}: until ${new Date(until).toLocaleString()}`)
  }

  const budget = new SpendLedger()
  if (config.budget) {
    console.log(`\nGlobal spend today: $${budget.dailyTotal().toFixed(4)}${config.budget.dailyUsd ? ` / $${config.budget.dailyUsd}` : ""}`)
    console.log(`Global spend this month: $${budget.monthlyTotal().toFixed(4)}${config.budget.monthlyUsd ? ` / $${config.budget.monthlyUsd}` : ""}`)
  }
}
