import * as path from "node:path"
import * as os from "node:os"

export const PACKAGE_NAME = "zenox-router"

function xdgConfigDir(): string {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}

function xdgDataDir(): string {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support")
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
}

/** OpenCode's own global config dir (~/.config/opencode). Where opencode.json and our own config live. */
export function getOpencodeConfigDir(): string {
  return path.join(xdgConfigDir(), "opencode")
}

/** OpenCode's own global data dir (auth.json, sessions, etc). Platform-correct per OpenCode's Global.Path.data. */
export function getOpencodeDataDir(): string {
  return path.join(xdgDataDir(), "opencode")
}

/** OpenCode's own auth.json — read-only, never written by zenox-router. */
export function getOpencodeAuthPath(): string {
  return path.join(getOpencodeDataDir(), "auth.json")
}

/** Global zenox-router routing config: categories, cascades, thresholds, budgets. */
export function getGlobalRouterConfigPath(): string {
  return path.join(getOpencodeConfigDir(), `${PACKAGE_NAME}.json`)
}

/** Project-level override, same shape as the global config, fully replaces it when present. */
export function getProjectRouterConfigPath(projectDir: string): string {
  return path.join(projectDir, ".opencode", `${PACKAGE_NAME}.json`)
}

/** Jev/OpenRouter key + any manually-added downstream provider keys. 0600 perms, never touched by OpenCode. */
export function getCredentialsPath(): string {
  return path.join(getOpencodeConfigDir(), `${PACKAGE_NAME}.credentials.json`)
}

/** Per-provider health/circuit-breaker state, persisted so it survives OpenCode restarts within a cooldown. */
export function getHealthStatePath(): string {
  return path.join(getOpencodeDataDir(), PACKAGE_NAME, "health.json")
}

/** Local spend ledger for budget enforcement. */
export function getSpendLedgerPath(): string {
  return path.join(getOpencodeDataDir(), PACKAGE_NAME, "spend.json")
}

/** Cached models.dev catalog, refreshed on setup/update with a TTL. */
export function getModelsDevCachePath(): string {
  return path.join(getOpencodeConfigDir(), PACKAGE_NAME, "models-dev-cache.json")
}
