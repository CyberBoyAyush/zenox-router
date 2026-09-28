/**
 * A SECOND, independently-written representative set — different tech
 * domains and different phrasing/sentence patterns from prompts-generated.ts
 * — used as a held-out generalization check after the category wording was
 * finalized against the first eval round. See docs/implementation.md.
 */
import type { EvalPrompt } from "./prompts"

interface D {
  id: string; label: string; lang: string; file: string; func: string
  v1: string; v2: string; dep: string; syntaxQ: string; feature: string
  bug: string; refactor: string; subsystem: string; constraint: string
  secTopic: string; secConcern: string; manyFiles: string; edge: string
}

const D2: D[] = [
  { id: "rails", label: "the Rails app", lang: "Ruby", file: "app/models/invoice.rb", func: "calculate_total", v1: "amt", v2: "amount", dep: "stripe-ruby",
    syntaxQ: "use a scope instead of a class method", feature: "credit-note support on invoices", bug: "voided invoices still count toward the total",
    refactor: "use a service object instead of a fat model method", subsystem: "billing engine", constraint: "existing accounting exports",
    secTopic: "mass-assignment protection on invoice params", secConcern: "a customer editing another tenant's invoice via a crafted param",
    manyFiles: "every controller that touches invoices", edge: "the invoice has zero line items" },
  { id: "laravel", label: "the Laravel API", lang: "PHP", file: "app/Http/Controllers/BookingController.php", func: "store", v1: "usr", v2: "user",
    dep: "laravel/sanctum", syntaxQ: "use a form request instead of inline validation", feature: "waitlist support when a slot is full",
    bug: "two people can book the same slot if they submit within the same second", refactor: "move validation into a FormRequest class",
    subsystem: "booking/availability engine", constraint: "existing bookings already stored",
    secTopic: "authorization policy on who can cancel a booking", secConcern: "a user cancelling someone else's booking by guessing the ID",
    manyFiles: "every route in routes/api.php touching bookings", edge: "the slot capacity is exactly one" },
  { id: "dotnet", label: "the .NET service", lang: "C#", file: "Services/OrderService.cs", func: "PlaceOrder", v1: "qty", v2: "quantity",
    dep: "Microsoft.EntityFrameworkCore", syntaxQ: "use a nullable reference type correctly", feature: "an endpoint to split one order into two shipments",
    bug: "the order total is wrong when a discount code is combined with free shipping", refactor: "extract the pricing logic into its own class",
    subsystem: "order fulfillment pipeline", constraint: "the existing warehouse integration",
    secTopic: "role-based access on order management", secConcern: "a warehouse-role account being able to issue refunds",
    manyFiles: "every controller injecting IOrderService", edge: "the order has already shipped when the split is requested" },
  { id: "elixir", label: "the Elixir/Phoenix service", lang: "Elixir", file: "lib/app/accounts.ex", func: "authenticate_user", v1: "pw", v2: "password",
    dep: "phoenix_token", syntaxQ: "pattern match on an :ok/:error tuple", feature: "magic-link login as an alternative to passwords",
    bug: "a GenServer occasionally stops responding after a deploy", refactor: "move the context logic out of the controller",
    subsystem: "session/auth supervision tree", constraint: "existing active LiveView sessions",
    secTopic: "token expiry handling for magic links", secConcern: "a magic-link token being reusable after it's already been consumed",
    manyFiles: "every LiveView that calls Accounts.authenticate_user", edge: "the user requests two magic links in a row" },
  { id: "flutter", label: "the Flutter app", lang: "Dart", file: "lib/features/cart/cart_provider.dart", func: "applyPromoCode", v1: "tot", v2: "total",
    dep: "provider", syntaxQ: "use a StreamBuilder instead of setState", feature: "a swipe-to-remove gesture on cart items",
    bug: "the cart badge count doesn't update after removing the last item", refactor: "move cart state into Riverpod instead of Provider",
    subsystem: "offline cart persistence layer", constraint: "existing carts already saved on-device",
    secTopic: "storage of saved payment tokens on-device", secConcern: "a rooted device exposing stored card tokens",
    manyFiles: "every screen that reads cart state", edge: "the promo code is applied twice in a row" },
  { id: "svelte", label: "the SvelteKit site", lang: "TypeScript", file: "src/routes/checkout/+page.server.ts", func: "load", v1: "cid", v2: "cartId",
    dep: "@sveltejs/kit", syntaxQ: "use a form action instead of a client fetch", feature: "guest checkout without an account",
    bug: "refreshing the checkout page loses the selected shipping option", refactor: "move the pricing calc into a shared server util",
    subsystem: "checkout and payment-intent flow", constraint: "the existing Stripe payment intents already created",
    secTopic: "CSRF protection on the checkout form action", secConcern: "a forged cross-site request submitting an order on someone's behalf",
    manyFiles: "every +page.server.ts under routes/checkout", edge: "the cart becomes empty between page load and submit" },
  { id: "django", label: "the Django backend", lang: "Python", file: "orders/views.py", func: "cancel_order", v1: "oid", v2: "order_id",
    dep: "djangorestframework", syntaxQ: "use select_related to avoid N+1 queries", feature: "an endpoint to reorder a previous order",
    bug: "cancelling an order doesn't restock the inventory", refactor: "move the cancellation logic into a model method",
    subsystem: "inventory reservation system", constraint: "the existing nightly inventory reconciliation job",
    secTopic: "object-level permission checks on order cancellation", secConcern: "a user cancelling another user's order by ID",
    manyFiles: "every view that imports the Order model", edge: "the order was already partially refunded" },
  { id: "fastapi", label: "the FastAPI service", lang: "Python", file: "app/routers/upload.py", func: "upload_file", v1: "sz", v2: "file_size",
    dep: "python-multipart", syntaxQ: "declare a dependency with Depends()", feature: "resumable multipart uploads for large files",
    bug: "uploads over 50MB silently fail with no error message", refactor: "move file validation into a Pydantic validator",
    subsystem: "async job queue for post-upload processing", constraint: "existing S3 bucket layout",
    secTopic: "content-type validation on uploaded files", secConcern: "an uploaded file being served back with an executable content-type",
    manyFiles: "every router that accepts file uploads", edge: "the client disconnects mid-upload" },
  { id: "deno", label: "the Deno edge function", lang: "TypeScript", file: "functions/geo-redirect.ts", func: "handler", v1: "cc", v2: "countryCode",
    dep: "std/http", syntaxQ: "read a header case-insensitively", feature: "an allowlist override for specific IPs",
    bug: "the redirect loops forever for users in one specific region", refactor: "extract the country-to-region mapping into a config file",
    subsystem: "edge routing/redirect layer", constraint: "existing cached redirect rules at the CDN",
    secTopic: "trusting the X-Forwarded-For header for geo decisions", secConcern: "a spoofed header bypassing a region restriction",
    manyFiles: "every edge function that reads geo headers", edge: "the header is missing entirely" },
  { id: "kafka", label: "the Kafka event pipeline", lang: "Java", file: "src/main/java/pipeline/OrderConsumer.java", func: "consume", v1: "off", v2: "offset",
    dep: "kafka-clients", syntaxQ: "commit offsets manually instead of auto-commit", feature: "a dead-letter topic for poison messages",
    bug: "consumer lag spikes every night at the same time", refactor: "extract the deserialization logic into its own class",
    subsystem: "exactly-once processing guarantees", constraint: "consumers already running in production",
    secTopic: "ACLs restricting which services can produce to the orders topic", secConcern: "an unauthorized service publishing forged order events",
    manyFiles: "every consumer group reading the orders topic", edge: "a message fails deserialization" },
  { id: "redis-cache", label: "the Redis caching layer", lang: "Go", file: "internal/cache/product.go", func: "GetProduct", v1: "ttl", v2: "expirySeconds",
    dep: "go-redis", syntaxQ: "set a key with an expiry atomically", feature: "cache warming on deploy for top products",
    bug: "stale prices are served for a few minutes after a price change", refactor: "extract the cache-key format into a shared helper",
    subsystem: "cache invalidation strategy", constraint: "the existing pub/sub invalidation channel",
    secTopic: "cache key namespacing between tenants", secConcern: "one tenant's cached data being served to another tenant",
    manyFiles: "every service reading from the product cache", edge: "the cache and the database disagree at read time" },
  { id: "video", label: "the video transcoding pipeline", lang: "Python", file: "transcode/worker.py", func: "process_upload", v1: "brt", v2: "bitrate",
    dep: "ffmpeg-python", syntaxQ: "run ffmpeg as a subprocess with a timeout", feature: "automatic thumbnail generation at upload time",
    bug: "some vertical videos get transcoded with the wrong rotation", refactor: "extract the ffmpeg command building into its own function",
    subsystem: "multi-resolution encoding ladder", constraint: "existing videos already encoded at the old settings",
    secTopic: "validating uploaded video files before passing them to ffmpeg", secConcern: "a crafted file exploiting an ffmpeg parser vulnerability",
    manyFiles: "every worker that shells out to ffmpeg", edge: "the source file has no audio track" },
  { id: "chrome-ext", label: "the Chrome extension", lang: "TypeScript", file: "src/background/service-worker.ts", func: "onMessage", v1: "tid", v2: "tabId",
    dep: "webextension-polyfill", syntaxQ: "use chrome.storage instead of localStorage in a service worker", feature: "a badge counter showing unread items",
    bug: "the extension stops responding to messages after the browser is idle a while", refactor: "split the service worker into smaller message handlers",
    subsystem: "manifest v3 permission and messaging model", constraint: "existing users' saved settings",
    secTopic: "content-script to background message validation", secConcern: "a malicious page's script forging a message the extension trusts",
    manyFiles: "every content script that sends runtime messages", edge: "the tab is closed while a message is in flight" },
  { id: "iot", label: "the IoT device fleet", lang: "C", file: "src/mqtt/publisher.c", func: "publish_telemetry", v1: "tmp", v2: "temperature",
    dep: "paho-mqtt", syntaxQ: "set a QoS level on a publish", feature: "batching telemetry points before publishing to save bandwidth",
    bug: "devices occasionally publish duplicate telemetry after a reconnect", refactor: "extract the topic-name construction into a helper",
    subsystem: "device provisioning and cert rotation", constraint: "already-deployed devices in the field",
    secTopic: "TLS client certificate validation for device connections", secConcern: "a cloned device certificate being used to impersonate a real device",
    manyFiles: "every firmware module that publishes over MQTT", edge: "the broker is unreachable when telemetry is due" },
  { id: "solidity", label: "the Solidity smart contract", lang: "Solidity", file: "contracts/Escrow.sol", func: "release", v1: "amt", v2: "amount",
    dep: "openzeppelin-contracts", syntaxQ: "use a modifier for an access check", feature: "a partial-release function for milestone payments",
    bug: "release can be called twice for the same milestone under certain gas conditions", refactor: "extract repeated require() checks into a modifier",
    subsystem: "reentrancy-safe fund release logic", constraint: "funds already locked in deployed contracts",
    secTopic: "reentrancy protection on the release function", secConcern: "a malicious receiving contract draining funds via reentrancy",
    manyFiles: "every contract that calls into Escrow", edge: "the release amount exceeds the remaining escrow balance" },
  { id: "ml-serving", label: "the ML inference server", lang: "Python", file: "serving/handler.py", func: "predict", v1: "bs", v2: "batchSize",
    dep: "torchserve", syntaxQ: "batch requests with a max wait time", feature: "a warm-up request on startup to avoid a cold first-call latency spike",
    bug: "p99 latency doubled after the last model version rollout", refactor: "extract preprocessing into a separate reusable function",
    subsystem: "multi-model routing and autoscaling", constraint: "existing clients pinned to the current model version",
    secTopic: "input validation before it reaches the model", secConcern: "a crafted input causing excessive memory allocation (a DoS vector)",
    manyFiles: "every handler that shares the preprocessing pipeline", edge: "a request arrives with zero valid input features" },
  { id: "grpc", label: "the gRPC service mesh", lang: "Go", file: "internal/server/inventory.go", func: "ReserveItem", v1: "cnt", v2: "count",
    dep: "google.golang.org/grpc", syntaxQ: "set a deadline on an outgoing gRPC call", feature: "a streaming endpoint for bulk inventory reservations",
    bug: "reservations occasionally double-count under retry storms", refactor: "extract the retry/backoff logic into a shared interceptor",
    subsystem: "distributed reservation consistency", constraint: "existing downstream services calling the old unary API",
    secTopic: "mTLS between services in the mesh", secConcern: "an unauthenticated service being able to call internal reservation RPCs",
    manyFiles: "every service with a generated inventory client", edge: "two reservation requests for the same item arrive within a millisecond" },
  { id: "wasm", label: "the WebAssembly module", lang: "Rust", file: "src/lib.rs", func: "process_image", v1: "w", v2: "width",
    dep: "wasm-bindgen", syntaxQ: "pass a typed array between JS and Wasm", feature: "a progress callback during a long-running Wasm computation",
    bug: "the Wasm module occasionally returns garbage output on Safari specifically", refactor: "extract the pixel-loop into its own function",
    subsystem: "memory management across the JS/Wasm boundary", constraint: "existing callers using the current exported function signatures",
    secTopic: "bounds-checking on buffer indices coming from JS", secConcern: "an out-of-bounds read/write from a malicious buffer length",
    manyFiles: "every JS caller of the exported Wasm functions", edge: "the input image has zero width or height" },
  { id: "scala-akka", label: "the Scala/Akka system", lang: "Scala", file: "src/main/scala/actors/OrderActor.scala", func: "receive", v1: "st", v2: "state",
    dep: "akka-persistence", syntaxQ: "pattern match on a sealed trait", feature: "an actor supervision strategy for a flaky downstream call",
    bug: "an actor occasionally gets stuck in a state after a supervisor restart", refactor: "extract the persistence event handlers into a trait",
    subsystem: "event-sourced actor persistence", constraint: "already-persisted event logs from production",
    secTopic: "authorization before an actor applies a state-changing command", secConcern: "a forged command message being applied without an ownership check",
    manyFiles: "every actor that extends the base OrderActor", edge: "a duplicate command is redelivered after an actor restart" },
]

function push(out: EvalPrompt[], id: string, message: string, expected: EvalPrompt["expected"], recentContext?: string) {
  out.push({ id, message, expected, recentContext, set: "fresh" })
}

function gen2(): EvalPrompt[] {
  const out: EvalPrompt[] = []
  for (const d of D2) {
    const t = d.id
    push(out, `g2-${t}-q1`, `Typo in ${d.file} — the comment above ${d.func} says "recieve", fix it.`, "quick")
    push(out, `g2-${t}-q2`, `${d.v1} is a bad variable name in ${d.file}, rename it to ${d.v2}.`, "quick")
    push(out, `g2-${t}-q3`, `Quick ${d.lang} question — how do I ${d.syntaxQ}?`, "quick")
    push(out, `g2-${t}-q4`, `Formatting's off in ${d.file}, can you clean it up?`, "quick")
    push(out, `g2-${t}-q5`, `What's ${d.dep} used for in ${d.label}?`, "quick")
    push(out, `g2-${t}-q6`, `One-line comment above ${d.func} would help, can you add it?`, "quick")

    push(out, `g2-${t}-s1`, `Can we get ${d.feature} added to ${d.label}?`, "standard")
    push(out, `g2-${t}-s2`, `${d.func} is buggy — ${d.bug}. Should be a quick-ish fix once you see it.`, "standard")
    push(out, `g2-${t}-s3`, `Needs test coverage: ${d.func} in ${d.file}. Normal case plus a couple edge cases is fine.`, "standard")
    push(out, `g2-${t}-s4`, `Walk me through what ${d.func} in ${d.file} actually does.`, "standard")
    push(out, `g2-${t}-s5`, `${d.func} could use a cleanup — ${d.refactor}.`, "standard")
    push(out, `g2-${t}-s6`, `${d.func} feels slow but I haven't dug in — got a minute to take a first look?`, "standard")

    push(out, `g2-${t}-h1`, `We need a real plan for reworking ${d.label}'s ${d.subsystem} without breaking ${d.constraint} — this is bigger than a quick patch.`, "heavy")
    push(out, `g2-${t}-h2`, `${d.func}'s bug came back after the last fix — need someone to actually dig into the real cause this time.`, "heavy")
    push(out, `g2-${t}-h3`, `How should we approach ${d.secTopic} for ${d.label}? Worried about ${d.secConcern}.`, "heavy")
    push(out, `g2-${t}-h4`, `Reworking the ${d.subsystem} is going to touch ${d.manyFiles} — let's plan it out before touching anything.`, "heavy")
    push(out, `g2-${t}-h5`, `Getting sporadic failures in ${d.label} in prod, can't get it to happen on my machine — need help figuring out how to even approach debugging it.`, "heavy")
    push(out, `g2-${t}-h6`, `${d.func} needs to be faster, current approach isn't going to cut it at our scale anymore.`, "heavy")

    push(out, `g2-${t}-r1`, `Put together ${d.feature} for ${d.label}, here's the diff — mind giving it a look before I merge?`, "review")
    push(out, `g2-${t}-r2`, `Finished ${d.func}, want to sanity check it myself before shipping — can you go over it?`, "review")
    push(out, `g2-${t}-r3`, `Can you audit how ${d.label} handles ${d.secTopic}? Want to make sure ${d.secConcern} isn't possible.`, "review")
    push(out, `g2-${t}-r4`, `Does this handle the case where ${d.edge} correctly?`, "review", `User pasted a diff touching ${d.func} in ${d.file}.`)
    push(out, `g2-${t}-r5`, `Any regressions in this change to ${d.func}?`, "review", `User pasted the updated ${d.func} implementation.`)
    push(out, `g2-${t}-r6`, `Take a pass over this PR for ${d.label} — error handling solid enough?`, "review")
  }
  return out
}

export const GENERATED_PROMPTS_2: EvalPrompt[] = gen2()
