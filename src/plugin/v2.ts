import { Plugin, Provider, Model } from "@opencode/plugin"
import { initRouterRuntime, ZENOX_ROUTER_PROVIDER_ID, ZENOX_ROUTER_MODEL_ID, ZENOX_ROUTER_MODEL_NAME } from "./shared"

/**
 * V2 plugin entry (Plugin.define). Same architecture as V1 (see v1.ts) —
 * registers "Zenox Router" as its own OpenAI-compatible provider backed by
 * the local proxy server. V2 does not need the V1 chat.params
 * maxOutputTokens workaround: the outbound max_tokens cap bug is V1-branch
 * only (confirmed fixed on v2 — see context/limits.ts docs), and V2 has no
 * documented equivalent to chat.params/chat.headers in its ctx surface
 * anyway (see docs/implementation.md).
 */
export default Plugin.define({
  id: "zenox-router",
  async setup(ctx) {
    const runtime = await initRouterRuntime(ctx.location.directory)
    const providerID = ZENOX_ROUTER_PROVIDER_ID as Provider.ID

    const registration = await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: ZENOX_ROUTER_MODEL_NAME,
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          // apiKey becomes the Authorization header the AI SDK sends — shared secret that stops any
          // other local process on the same machine from reaching our proxy (see http-server.ts).
          settings: { baseURL: `http://127.0.0.1:${runtime.port}/v1`, apiKey: runtime.authToken },
        },
        models: [
          {
            ...Model.Info.default(providerID, ZENOX_ROUTER_MODEL_ID as Model.ID),
            name: ZENOX_ROUTER_MODEL_NAME,
            limit: runtime.declaredLimits,
          },
        ],
      })
    })

    return async () => {
      await registration.dispose()
      await runtime.server.stop()
    }
  },
})
