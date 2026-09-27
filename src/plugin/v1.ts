import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { initRouterRuntime, ZENOX_ROUTER_PROVIDER_ID, ZENOX_ROUTER_MODEL_ID, ZENOX_ROUTER_MODEL_NAME } from "./shared"

/**
 * V1 plugin entry. Registers "Zenox Router" as its own OpenAI-compatible
 * provider, backed by a local node:http server this function starts. This
 * is the only working pattern for a plugin to run fully custom per-request
 * routing logic — there is no V1 hook that lets a plugin intercept an
 * in-flight chat request and redirect it to a different provider/model; see
 * docs/implementation.md for the full research trail. `config` mutates the
 * passed-in object in place (confirmed against the installed
 * @opencode-ai/plugin types — it returns void, not a new Config).
 */
export const ZenoxRouterPluginV1: Plugin = async (input: PluginInput) => {
  const runtime = await initRouterRuntime(input.directory)

  return {
    dispose: async () => {
      await runtime.server.stop()
    },

    config: async (config) => {
      const cfg = config as unknown as {
        provider?: Record<string, { npm?: string; name?: string; options?: Record<string, unknown>; models?: Record<string, { name?: string; limit?: { context: number; output: number } }> }>
      }
      cfg.provider ??= {}
      cfg.provider[ZENOX_ROUTER_PROVIDER_ID] = {
        npm: "@ai-sdk/openai-compatible",
        name: ZENOX_ROUTER_MODEL_NAME,
        // apiKey becomes the `Authorization: Bearer <apiKey>` header the AI SDK sends — this is the
        // shared secret that stops any other local process from reaching our proxy (see http-server.ts).
        options: { baseURL: `http://127.0.0.1:${runtime.port}/v1`, apiKey: runtime.authToken },
        models: {
          [ZENOX_ROUTER_MODEL_ID]: {
            name: ZENOX_ROUTER_MODEL_NAME,
            limit: runtime.declaredLimits,
          },
        },
      }
    },

    // Bypasses the V1 dev-branch bug where outbound max_tokens is silently capped at 32,000
    // regardless of a model's declared limit.output (fixed on the v2 branch — see
    // context/limits.ts computeMaxOutputAcrossPool docs). A static pool-wide ceiling is used
    // rather than per-request classification here, so this never needs a Jev call of its own;
    // the proxy's own downstream call always re-clamps to whichever specific model actually
    // gets selected, so a generous ceiling here can't cause an over-large request to reach a
    // small-output model.
    "chat.params": async (chatInput, output) => {
      if (chatInput.provider?.info?.id !== ZENOX_ROUTER_PROVIDER_ID) return
      output.maxOutputTokens = runtime.maxOutputAcrossPool
    },
  }
}
