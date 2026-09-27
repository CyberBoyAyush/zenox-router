import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { getModelsDevCachePath } from "../config/paths"

const MODELS_DEV_URL = "https://models.dev/api.json"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

export interface ModelsDevModel {
  id: string
  name: string
  description?: string
  attachment: boolean
  reasoning: boolean
  tool_call: boolean
  limit: { context: number; input?: number; output: number }
  cost: { input: number; output: number; cache_read?: number; cache_write?: number }
}

export interface ModelsDevProvider {
  id: string
  name: string
  npm?: string
  env?: string[]
  api?: string
  models: Record<string, ModelsDevModel>
}

export type ModelsDevCatalog = Record<string, ModelsDevProvider>

interface CacheFile {
  fetchedAt: number
  catalog: ModelsDevCatalog
}

function readCache(): CacheFile | null {
  const path = getModelsDevCachePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CacheFile
  } catch {
    return null
  }
}

function writeCache(catalog: ModelsDevCatalog): void {
  const path = getModelsDevCachePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ fetchedAt: Date.now(), catalog }, null, 2), "utf-8")
}

/**
 * Fetches the full models.dev catalog, cached for CACHE_TTL_MS. Pass
 * `forceRefresh: true` (used by `zenox-router update`) to bypass the cache.
 * Falls back to a stale cache on network failure rather than throwing, so a
 * flaky connection during `setup` doesn't hard-fail the wizard.
 */
export async function fetchModelsDevCatalog(opts: { forceRefresh?: boolean } = {}): Promise<ModelsDevCatalog> {
  const cache = readCache()
  const cacheIsFresh = cache !== null && Date.now() - cache.fetchedAt < CACHE_TTL_MS
  if (cacheIsFresh && !opts.forceRefresh) return cache.catalog

  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
    const catalog = (await response.json()) as ModelsDevCatalog
    writeCache(catalog)
    return catalog
  } catch (err) {
    if (cache) return cache.catalog // stale-but-usable fallback
    throw new Error(`Failed to fetch models.dev catalog and no cache is available: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface FlatModel {
  ref: string // "provider/model"
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  context: number
  output: number
  costInput: number
  costOutput: number
  toolCall: boolean
}

export function flattenCatalog(catalog: ModelsDevCatalog): FlatModel[] {
  const out: FlatModel[] = []
  for (const [providerId, provider] of Object.entries(catalog)) {
    for (const [modelId, model] of Object.entries(provider.models)) {
      out.push({
        ref: `${providerId}/${modelId}`,
        providerId,
        providerName: provider.name,
        modelId,
        modelName: model.name,
        context: model.limit.context,
        output: model.limit.output,
        costInput: model.cost.input,
        costOutput: model.cost.output,
        toolCall: model.tool_call,
      })
    }
  }
  return out
}

/** Case-insensitive search across provider name/id and model name/id. */
export function searchModels(models: FlatModel[], query: string): FlatModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter(
    (m) =>
      m.ref.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q) ||
      m.providerId.toLowerCase().includes(q) ||
      m.modelName.toLowerCase().includes(q),
  )
}

export function filterByProvider(models: FlatModel[], providerId: string): FlatModel[] {
  return models.filter((m) => m.providerId === providerId)
}

export function listProviders(catalog: ModelsDevCatalog): { id: string; name: string; modelCount: number }[] {
  return Object.entries(catalog)
    .map(([id, p]) => ({ id, name: p.name, modelCount: Object.keys(p.models).length }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Look up a single model's known limits by its "provider/model" ref, for context-window calc. */
export function lookupModel(catalog: ModelsDevCatalog, ref: string): FlatModel | undefined {
  const [providerId, ...rest] = ref.split("/")
  const modelId = rest.join("/")
  const provider = providerId ? catalog[providerId] : undefined
  const model = provider?.models[modelId]
  if (!provider || !model) return undefined
  return { ref, providerId: providerId!, providerName: provider.name, modelId, modelName: model.name, context: model.limit.context, output: model.limit.output, costInput: model.cost.input, costOutput: model.cost.output, toolCall: model.tool_call }
}
