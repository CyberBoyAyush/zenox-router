import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import stripJsonComments from "strip-json-comments"
import { PACKAGE_NAME, getOpencodeConfigDir } from "../config/paths"

const CONFIG_FILENAMES = ["opencode.json", "opencode.jsonc"]

interface OpencodeConfigFile {
  path: string
  format: "json" | "jsonc"
}

interface OpencodeConfigContent {
  plugin?: string[]
  plugins?: string[]
  [key: string]: unknown
}

/** Search order: project .opencode/ subdir, project root, then global (~/.config/opencode). Matches OpenCode's own resolution order. */
export function findConfigFile(directory: string): OpencodeConfigFile | null {
  const searchPaths = [join(directory, ".opencode"), directory, getOpencodeConfigDir()]
  for (const dir of searchPaths) {
    for (const filename of CONFIG_FILENAMES) {
      const path = join(dir, filename)
      if (existsSync(path)) return { path, format: filename.endsWith(".jsonc") ? "jsonc" : "json" }
    }
  }
  return null
}

export function getGlobalConfigPath(): string {
  return join(getOpencodeConfigDir(), "opencode.json")
}

export async function readConfig(path: string): Promise<{ content: string; config: OpencodeConfigContent }> {
  const content = await readFile(path, "utf-8")
  const config = JSON.parse(stripJsonComments(content, { trailingCommas: true })) as OpencodeConfigContent
  return { content, config }
}

export function isPluginInstalled(config: OpencodeConfigContent): boolean {
  const plugins = config.plugins ?? config.plugin ?? []
  return plugins.some((p) => p === PACKAGE_NAME || p.startsWith(`${PACKAGE_NAME}@`))
}

export async function installPlugin(path: string): Promise<void> {
  const { config } = await readConfig(path)
  if (isPluginInstalled(config)) return
  const key = config.plugins ? "plugins" : "plugin"
  const existing = config.plugins ?? config.plugin ?? []
  const updated = { ...config, [key]: [PACKAGE_NAME, ...existing] }
  await writeFile(path, JSON.stringify(updated, null, 2) + "\n", "utf-8")
}

export async function createGlobalConfigWithPlugin(): Promise<string> {
  const path = getGlobalConfigPath()
  const { mkdirSync } = await import("node:fs")
  mkdirSync(getOpencodeConfigDir(), { recursive: true })
  await writeFile(path, JSON.stringify({ plugin: [PACKAGE_NAME] }, null, 2) + "\n", "utf-8")
  return path
}

/** Ensures zenox-router is registered as an OpenCode plugin (global config by default, matching "works globally"). Idempotent. */
export async function ensurePluginInstalled(directory: string): Promise<{ path: string; created: boolean; alreadyInstalled: boolean }> {
  const found = findConfigFile(directory)
  if (!found) {
    const path = await createGlobalConfigWithPlugin()
    return { path, created: true, alreadyInstalled: false }
  }
  const { config } = await readConfig(found.path)
  if (isPluginInstalled(config)) return { path: found.path, created: false, alreadyInstalled: true }
  await installPlugin(found.path)
  return { path: found.path, created: false, alreadyInstalled: false }
}
