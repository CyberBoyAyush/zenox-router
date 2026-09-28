# zenox-router — Implementation Notes

## Why this architecture

OpenCode has no plugin hook (V1 or V2) that lets a plugin intercept an in-flight chat request and redirect it to a different provider/model. Research against the actual installed `@opencode-ai/plugin` (V1, `Hooks` interface) and `@opencode/plugin` (V2, Promise-based `Plugin.define`) packages confirmed this. The only working pattern — used by real plugins in the wild (`opencode-with-claude`, `opencode-9router-model-sync`) — is:

> Register your own OpenAI-compatible **provider**, backed by a local HTTP server your plugin starts itself. OpenCode just sees another model and POSTs to your server like any other provider. Your server does the actual classification + routing + real provider call.

That's what "Zenox Router" is: a single registered model whose `baseURL` points at a `node:http` server the plugin starts on load.

**Why `node:http`, not `Bun.serve()`**: `Bun.serve()` conflicts with OpenCode's own internal server — only one instance is allowed per process. A real plugin (`opencode-preview`) hit and fixed this exact bug by switching to `node:http`. Confirmed via source research before writing a line of the server.

**Dual V1/V2 export**: `@opencode-ai/plugin`'s V1 loader accepts either a bare plugin function or an object matching `PluginModule` (`{id?, server}`) as its default export (confirmed against the installed package's own type). `@opencode/plugin`'s V2 loader reads `id`/`setup` off the same default export. `src/index.ts` merges both shapes into one object, so one package works on either OpenCode generation.

## The classification layer (Jev)

Jev (`typesafe/jev-1.13` via OpenRouter's Decisions API) is not an LLM — it's a "System One" decision model that answers typed `choice`/`score`/`noul` questions with calibrated probabilities, at $0.042/M input tokens with free output. One `choice` question, criteria = the user's configured category descriptions.

### Taxonomy design

Default categories: `quick` / `standard` / `heavy` / `review`. External research (RouteLLM, OpenRouter's own auto-router, the EMNLP 2025 "Select-Then-Route" paper) generally keeps a task-type axis and a difficulty axis separate rather than mixing them into one categorical choice. Oracle reviewed this tension directly and recommended keeping the single flat 4-category choice **as a precedence-based partition, not four equivalent tiers**: `review` wins whenever the primary ask is evaluating already-finished work, regardless of complexity; otherwise pick by difficulty. This is encoded as an explicit `CATEGORY_PRECEDENCE_RULE` sent alongside the per-category criteria (see `src/jev/categories.ts`).

### Eval methodology and results

Four eval slices, combined in `eval/run-eval.ts`:
- **core** (93 prompts) — hand-crafted, covers each category plus deliberately ambiguous boundary cases.
- **stress** (37 prompts) — adversarial cases targeting the specific precedence rule (review-vs-heavy on the same subject matter, trigger words without review intent, short-but-dangerous security edits, large-but-mechanical edits, prompt-injection via pasted artifacts).
- **representative** (456 prompts) — combinatorial generation across 19 tech domains (React, Rails, Kafka, Solidity, embedded C, etc.) × 6 phrasing templates × 4 categories.
- **fresh** (456 prompts) — a second, independently-written representative set (19 *different* domains, different phrasing style) built specifically as a held-out generalization check after the wording was tuned against the first three sets.

**Result: 97.1% overall accuracy across 1042 prompts** (core 94.6%, stress 89.2%, representative 98.7%, fresh 96.7% — the close gap between representative and fresh confirms genuine generalization, not overfitting to specific wording). `review` recall is ~100% across every slice.

**Real-world validation**: no prior OpenCode session history existed to mine (checked first — only one session existed). Instead, 600 real user messages were sampled from the user's actual `~/.local/share/opencode/opencode.db` SQLite history (5,331 sessions, 17,872 real user messages), filtered for secrets/length/circularity, and run unlabeled for distribution/confidence sanity-checking, plus a 140-message stratified subset hand-labeled for a real computed accuracy figure: **65.7% raw / 74.3% post-confidence-threshold**. This is meaningfully lower than the clean synthetic accuracy — real informal, typo-heavy, rambling developer phrasing is inherently harder than curated prompts, and `review` alone stayed ~97% accurate even here (a large share of real usage turned out to genuinely be "analyze/audit this existing codebase" style requests). This gap is disclosed rather than chased into overfitting on the reviewer's own subjective labels for inherently ambiguous real messages. All real session data lives under `eval/private/` (gitignored, never shipped, never committed).

**Cost-savings estimate** (representative token-count assumptions, Sept 2026 provider pricing): routing vs. an always-frontier-model baseline saves roughly **29–34%** before Jev's own (negligible, ~$0.00007/request) overhead.

## Routing engine

- **`src/config/schema.ts`** — zod schema for the user's `RouterConfig`: categories (id, description, cascade, capabilityRank, optional budget, optional `inheritCascadeFrom` to alias another category's cascade), global/per-category budgets, confidence threshold, credential source policy.
- **`src/routing/health.ts`** — per-model circuit breaker + per-provider "exhausted" (account-wide, e.g. billing cap) state, persisted to disk so a known-exhausted provider stays skipped across OpenCode restarts. Rate-limit snapshots expire after 5 minutes so a stale header can't permanently block a model.
- **`src/routing/providers/classify-error.ts`** — per-provider (Anthropic/OpenAI/xAI/OpenRouter) HTTP response classification into `retry-same` / `cooldown` / `exhausted` / `fail-fast`, based on documented provider-specific behavior (e.g. Anthropic 429 with vs. without `retry-after` distinguishes true rate-limit from a spend cap; OpenAI's billing state is only distinguishable via `error.code` on a 429, not the status code; xAI can disguise an overload as HTTP 200 with an error-shaped body). Unlisted providers fall back to a conservative generic classifier.
- **`src/routing/cascade.ts`** — `selectModel` walks a category's cascade, filtering by health, budget, and (if given a token count) context-fit. If the category's own cascade is exhausted, it searches **every other category** (highest `capabilityRank` first) before giving up — this deliberately searches on context-exhaustion too, not just health-exhaustion, since a lower-rank category isn't guaranteed to have a smaller context window.
- **`src/context/limits.ts`** — the context/output limits declared to OpenCode for the registered model are the **minimum** across every model in every category's cascade (recomputed on every `setup`/`update`, never hardcoded) — OpenCode's own `limit.context` is a *soft* signal that only controls when its auto-compaction fires, not a hard cap, so a conservative minimum here is what keeps the conversation from growing past what the weakest configured model could take.
- **`src/routing/providers/anthropic-translate.ts`** — full request/response translation between OpenAI chat-completions shape (what OpenCode sends/expects) and Anthropic's Messages API shape, including tool calls, tool results, images, and `tool_choice`, plus SSE streaming translation.

## Self-review findings (two Oracle passes)

The first full-implementation review (no git history existed, so full source was given directly rather than a diff) found several real bugs before shipping, all fixed and covered by regression tests:

- **Streaming success reported before the request was even sent**: an async generator function's body does not execute until it is first iterated — an earlier version wrapped `fetch()` inside `async function*`, so the calling code's success/failure branching (and health/budget recording) ran before any network activity occurred. Fixed by splitting the fetch (`startAnthropicStream`, a plain `async function`) from the SSE-parsing generator (`parseAnthropicSSE`), so the caller can check `response.ok` before deciding success.
- **A chunk-boundary double-parse/double-bill bug**: the OpenAI-compatible streaming relay parsed whatever was currently in its buffer on every read, including a complete-looking JSON line that hadn't been newline-terminated by the transport yet — if that same line then arrived (now complete) in the next chunk, it was parsed and billed again. Fixed by only ever parsing lines already confirmed complete (the same "pop the last, possibly-partial line" pattern used on the Anthropic side), with a regression test exercising the exact worst-case split (right after the JSON's closing brace, before the trailing newline).
- **Truncated streams silently treated as successful completions**: neither streaming path checked for a genuine terminal event (Anthropic's `message_delta` with a `stop_reason`, or a `[DONE]` line) before treating end-of-stream as success — a dropped connection mid-generation looked identical to a clean finish. Both paths now throw if EOF arrives without that terminal signal.
- **`toAnthropicRequest` preferred the request's own `max_tokens` over the caller's computed clamp** — a pool-wide output ceiling (needed to work around a separate OpenCode V1 bug that silently caps outbound `max_tokens` at 32,000 regardless of a model's real limit) could reach a small-output Anthropic model unclamped.
- **No authentication on the local proxy**: binding to loopback stops remote connections, but any other local process running as the same OS user could otherwise reach it and spend the configured API keys. Fixed with a random per-process bearer token, generated at startup and set as the registered provider's `apiKey`/`settings.apiKey` (which the AI SDK sends as an `Authorization: Bearer` header), checked on every request.
- Several other findings (network exceptions escaping uncaught instead of advancing the cascade, `conversationText` estimation zeroing out array-content messages, a stale rate-limit snapshot able to permanently block a model, context-exhaustion skipping cross-category search) — see git-free review transcripts; all fixed in the same pass.

A second Oracle pass, run specifically against the fix diff, confirmed the critical/high findings resolved and surfaced the double-parse and truncated-stream issues above, which were fixed in a follow-up round and locked in with `test/sse-streaming.test.ts`.

## Known limitations (v1)

- Budget accounting for streaming responses depends on the downstream provider actually returning usage in-band (Anthropic's `message_delta`, or `stream_options: {include_usage: true}` for OpenAI-compatible providers); a provider that supports neither will stream successfully but record $0 spend for that call.
- A rare edge case: if one category is exhausted purely due to context size while a *different* category's cascade is unhealthy (not context) for every candidate, the surfaced error is `context-overflow` even though the real fix in that instant would be provider health, not compaction. Cosmetic — OpenCode's reaction (attempt to compact and retry) is still a benign, non-destructive response.
- Tool-choice/image translation is implemented for Anthropic; providers reached via the generic OpenAI-compatible path are assumed to already speak the same request shape OpenCode sends (true for the large majority of models.dev providers, which are themselves `@ai-sdk/openai-compatible`-based).
