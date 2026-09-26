import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { parseRouterConfig, type RouterConfig } from "./schema"
import { getGlobalRouterConfigPath, getProjectRouterConfigPath } from "./paths"

function readConfigFile(path: string): RouterConfig | null {
  if (!existsSync(path)) return null
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"))
  return parseRouterConfig(raw)
}

/**
 * Loads the routing config. A project-level config (.opencode/zenox-router.json)
 * fully REPLACES the global one when present, rather than merging field by
 * field — categories and their cascades are a coherent set defined together,
 * so partial merging would be confusing (e.g. a project overriding just one
 * category's cascade while silently inheriting unrelated global categories).
 * Returns null if neither exists — the user hasn't run `zenox-router setup`
 * yet, and the plugin should not register a provider with no real cascades.
 */
export function loadRouterConfig(projectDir?: string): RouterConfig | null {
  if (projectDir) {
    const projectConfig = readConfigFile(getProjectRouterConfigPath(projectDir))
    if (projectConfig) return projectConfig
  }
  return readConfigFile(getGlobalRouterConfigPath())
}

export function saveGlobalRouterConfig(config: RouterConfig): void {
  const validated = parseRouterConfig(config)
  const path = getGlobalRouterConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(validated, null, 2) + "\n", "utf-8")
}

export function saveProjectRouterConfig(projectDir: string, config: RouterConfig): void {
  const validated = parseRouterConfig(config)
  const path = getProjectRouterConfigPath(projectDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(validated, null, 2) + "\n", "utf-8")
}
