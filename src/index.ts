/**
 * zenox-router — OpenCode plugin that classifies each request with Jev
 * (TypeSafe's decision model on OpenRouter) and routes it to the best model
 * across your configured providers, with health/budget-aware fallback
 * cascades. See docs/implementation.md for the full architecture writeup.
 *
 * Dual V1/V2 export: @opencode-ai/plugin's V1 loader accepts either a bare
 * plugin function OR an object matching `PluginModule` (`{id?, server}`)
 * as its default export — confirmed against the installed package's own
 * `PluginModule` type. @opencode/plugin's V2 loader reads `id` + `setup`
 * off the same default export. One object satisfies both loaders.
 *
 * NOTE: do not add other top-level exports of runtime values here — OpenCode
 * V1 treats every export as a plugin instance to call (only the default
 * export should be a callable/plugin shape). Type-only exports are safe
 * (erased at build time, never present at runtime).
 */
import { ZenoxRouterPluginV1 } from "./plugin/v1"
import zenoxRouterV2 from "./plugin/v2"

const ZenoxRouter = {
  ...zenoxRouterV2,
  server: ZenoxRouterPluginV1,
}

export default ZenoxRouter

export type { RouterConfig, Category, Budget, CredentialSource } from "./config/schema"
export type { CategoryDefinition } from "./jev/categories"
