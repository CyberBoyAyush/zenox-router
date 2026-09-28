# zenox-router

An [OpenCode](https://opencode.ai) plugin that classifies each request with **Jev** (TypeSafe's decision model, served on OpenRouter) and routes it to the best model across your own configured providers — with health/circuit-breaker and budget-aware fallback cascades.

Select **"Zenox Router"** as your model in OpenCode. Every message is classified into a category (quick / standard / heavy / review, or your own custom ones) and routed to whichever real model in that category's cascade is currently healthy, affordable, and has room for the conversation. Selecting any other model bypasses this entirely — Zenox Router only ever activates when it's the active model.

## Install

```bash
npx zenox-router setup
```

This walks you through:
- Entering an OpenRouter API key (used only for Jev classification calls)
- Browsing/searching the full [models.dev](https://models.dev) catalog by provider, or entering a custom model
- Building categories and their fallback cascades (sensible defaults provided, fully customizable)
- Registering the plugin in your OpenCode config (`~/.config/opencode/opencode.json` by default)

Re-run `zenox-router update` any time to reconfigure or refresh the models.dev cache. `zenox-router status` shows current config, credential state, and provider health.

## How it works

1. **Classify**: Jev looks at your latest message (plus a short digest of recent turns) and picks a category — this costs a fraction of a cent and takes about a second.
2. **Route**: that category maps to an ordered list of real models. The first one that's healthy, within budget, and has enough context window gets the call.
3. **Fall back**: if a model is rate-limited, out of credits, or overloaded, the next one in the cascade is tried automatically — tracked via real per-provider rate-limit headers and error responses, not guesswork.
4. **Cross-category fallback**: if an entire category's cascade is exhausted, other categories are tried (preferring more-capable ones first) before giving up.

Credentials for the real downstream models are reused from OpenCode's own `opencode auth login` by default — nothing needs to be re-entered for providers you've already configured there.

## Config

Global config lives at `~/.config/opencode/zenox-router.json` (categories/cascades/budgets — safe to read/edit by hand) and `~/.config/opencode/zenox-router.credentials.json` (API keys, `0600` permissions). A project-level `.opencode/zenox-router.json` fully overrides the global config when present.

## Development

```bash
bun install
bun run typecheck
bun run build
bun test test/
bun run eval          # runs the Jev classifier against 1000+ labeled prompts (needs OPENROUTER_API_KEY in .env)
```

See [docs/implementation.md](./docs/implementation.md) for the full architecture writeup, research trail, and eval methodology.

## License

MIT
