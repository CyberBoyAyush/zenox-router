#!/usr/bin/env node
import { Command } from "commander"
import { runSetup } from "./setup"
import { runStatus } from "./status"
import { ensurePluginInstalled } from "./opencode-config"

function readPackageVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../../package.json") as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const program = new Command()

program.name("zenox-router").description("Zenox Router — Jev-classified, health/budget-aware model routing for OpenCode").version(readPackageVersion())

program
  .command("setup")
  .description("Interactive setup: OpenRouter key, categories, model cascades")
  .action(async () => {
    try {
      await runSetup({ isUpdate: false })
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command("update")
  .alias("config")
  .description("Reconfigure categories/cascades (refreshes the models.dev cache)")
  .action(async () => {
    try {
      await runSetup({ isUpdate: true })
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command("install")
  .description("Register zenox-router in opencode.json (also done automatically by setup)")
  .action(async () => {
    try {
      const result = await ensurePluginInstalled(process.cwd())
      console.log(result.alreadyInstalled ? `Already installed in ${result.path}` : `Installed in ${result.path}`)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command("status")
  .description("Show current config, credentials, and provider health")
  .action(() => {
    try {
      runStatus()
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program.parse()
