import { randomBytes } from "node:crypto"
import { loadRouterConfig } from "../config/store"
import { loadCredentials } from "../config/credentials"
import { fetchModelsDevCatalog, type ModelsDevCatalog } from "../modelsdev/client"
import { HealthTracker } from "../routing/health"
import { SpendLedger } from "../routing/budget"
import { ZenoxRouterServer } from "../server/http-server"
import { computeAggregateLimits, computeMaxOutputAcrossPool, type ManualLimits } from "../context/limits"
import type { RouterConfig } from "../config/schema"
import type { ProxyDeps } from "../server/proxy"

export const ZENOX_ROUTER_PROVIDER_ID = "zenox-router"
export const ZENOX_ROUTER_MODEL_ID = "auto"
export const ZENOX_ROUTER_MODEL_NAME = "Zenox Router"

export interface RouterRuntime {
  server: ZenoxRouterServer
  port: number
  config: RouterConfig | null
  catalog: ModelsDevCatalog
  manualLimits: ManualLimits
  health: HealthTracker
  budget: SpendLedger
  jevApiKey: string | undefined
  /** Declared to OpenCode for its own compaction-trigger math — see context/limits.ts. Sensible fallback if unconfigured. */
  declaredLimits: { context: number; output: number }
  /** Static maxOutputTokens ceiling for the V1 chat.params override (see plugin/v1.ts). */
  maxOutputAcrossPool: number
  /** Random per-process bearer token — set as the provider's options.apiKey/settings.apiKey so only OpenCode itself (which the AI SDK sends as `Authorization: Bearer <apiKey>`) can reach the local proxy, not any other local process on the same machine. */
  authToken: string
}

/**
 * Loads config, fetches (cached) models.dev metadata, and starts the local
 * proxy server. Called once per plugin load (V1 plugin function body / V2
 * setup()). If no config exists yet (user hasn't run `zenox-router setup`),
 * the server still starts but every request gets a clear "not configured"
 * error rather than the plugin silently doing nothing or crashing OpenCode.
 */
export async function initRouterRuntime(projectDir?: string): Promise<RouterRuntime> {
  const config = loadRouterConfig(projectDir)
  const catalog = config ? await fetchModelsDevCatalog().catch(() => ({}) as ModelsDevCatalog) : ({} as ModelsDevCatalog)
  const manualLimits: ManualLimits = config?.customModelLimits ?? {}
  const health = new HealthTracker()
  const budget = new SpendLedger()
  const jevApiKey = loadCredentials().jevApiKey

  const declaredLimits = config ? computeAggregateLimits(config.categories, catalog, manualLimits) : { context: 128_000, output: 8_000 }
  const maxOutputAcrossPool = config ? computeMaxOutputAcrossPool(config.categories, catalog, manualLimits) : 32_000
  const authToken = randomBytes(24).toString("hex")

  const server = new ZenoxRouterServer((): ProxyDeps | undefined => {
    if (!config || !jevApiKey) return undefined
    return { config, catalog, manualLimits, health, budget, jevApiKey }
  }, authToken)
  const port = await server.start()

  return { server, port, config, catalog, manualLimits, health, budget, jevApiKey, declaredLimits, maxOutputAcrossPool, authToken }
}
