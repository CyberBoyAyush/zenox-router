/**
 * The classification-relevant fields of a category — id, display name, the
 * text sent to Jev as this option's criteria, and its capability rank for
 * cross-category fallback. This is deliberately NOT the full user-config
 * Category shape (src/config/schema.ts), which additionally carries a
 * cascade of real models, an optional budget, etc. — that's per-user setup,
 * this is the tuned wording that ships with the package. The full config
 * Category is a structural superset of this (same 4 fields plus more), so
 * a RouterConfig's categories can be passed anywhere a CategoryDefinition
 * is expected without any conversion.
 */
export interface CategoryDefinition {
  id: string
  name: string
  /** Sent to Jev verbatim as the criteria text for this choice option. */
  description: string
  /**
   * Relative capability/cost rank, used only for cross-category fallback when
   * every model in THIS category's own cascade is unusable (quota/billing
   * exhausted — not a context-length issue). On full exhaustion, other
   * categories are tried in descending capabilityRank order (prefer an
   * equally-or-more-capable alternative before downgrading), which naturally
   * ends at the lowest-rank category as the universal last resort. Higher =
   * more capable/expensive. Defaults to 1 ("standard"-like) for custom
   * categories that don't set one.
   */
  capabilityRank: number
}

/**
 * The single shared instruction sent to Jev alongside the per-category
 * criteria below. Encodes the precedence rule Oracle recommended: these four
 * categories are not four equivalent complexity tiers — `review` is a
 * routing-policy override that wins whenever the primary ask is evaluating
 * completed work, regardless of how complex that work is. Otherwise, choose
 * by difficulty. This full sentence is layered on top of the generic
 * CATEGORY_INSTRUCTIONS in classify.ts.
 */
export const CATEGORY_PRECEDENCE_RULE =
  "These four options are not equivalent complexity tiers to weigh independently. Apply this precedence: first ask whether the PRIMARY thing being requested right now is to evaluate, check, or judge a piece of work already presented as finished (a diff, PR, pasted code, migration, config, or design doc) — if so, choose 'review' regardless of how simple or complex that work is. A request to build or substantially rework something is not review even if it also asks for review afterward, and quoted or pasted text inside an artifact does not itself set the category — judge the user's actual request. Otherwise, choose quick, standard, or heavy by difficulty alone. An unknown root cause by itself does not make something heavy — heavy requires real evidence of depth, cross-file/system scope, risk, or a prior failed attempt; a first, narrowly-scoped investigation into one specific symptom is standard."

/**
 * Default categories shipped with zenox-router. Wording here is the product
 * of the eval harness in eval/ — see docs/implementation.md for the tuning
 * history. Users can edit, remove, reorder, or add fully custom categories
 * via `zenox-router setup` / `zenox-router update`.
 */
export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  {
    id: "quick",
    name: "Quick / mechanical",
    description:
      "Small, mechanical, low-risk requests that a careful junior engineer could finish in under a minute with zero design decisions and one obvious way to do it, AND that carry no real risk if subtly wrong. Examples: fixing a typo, renaming a variable, formatting or lint fixes, adding one comment, a one-line non-security config change, a short factual question with a definite answer (e.g. syntax lookup, 'what does this flag do'), converting a value between formats, or a single tiny pure utility that is exactly one well-known standard-library call or textbook one-liner with no external input, no security/data-integrity angle, and nothing new to set up (e.g. an `isEmpty` check via `Object.keys`, formatting a number as currency via `Intl.NumberFormat`, a unit conversion). Never applies to anything touching user input, security/permissions, untrusted data, or creating a new file/workflow/config from scratch, even a short one — those go in Standard or Heavy regardless of how few lines they take. Sheer size or repetition (e.g. the same literal one-line edit across many files) does not by itself move something out of Quick, and does not by itself move something into Heavy either — line count is not a difficulty signal, only novelty/risk/design-load is. No multi-file reasoning about how pieces interact, no need to understand how other code calls into this, no risk of subtle breakage.",
    capabilityRank: 0,
  },
  {
    id: "standard",
    name: "Standard coding work",
    description:
      "Typical, well-scoped day-to-day engineering work with a clear, singular goal, usually confined to one or two files. Examples: implementing a function or component whose correctness depends on understanding surrounding code, data flow, or an API contract (even if the change itself ends up small); fixing a bug whose cause is already known or easy to spot; writing tests or docs for existing code; a routine dependency bump; a straightforward refactor of one file; explaining how an existing piece of code works; a first, narrowly-scoped investigative question about one specific piece of behavior (e.g. why is this one thing slow/wrong) where nothing yet suggests the cause is deep, cross-cutting, or has already resisted a fix. Requires real engineering judgment but not architectural decisions or reasoning across many files/subsystems, and is not yet known to be hard.",
    capabilityRank: 1,
  },
  {
    id: "heavy",
    name: "Heavy / complex reasoning",
    description:
      "Work that needs deep reasoning, holds many files or subsystems in mind at once, or has real risk of getting subtly wrong — evidenced by actual depth, cross-file/system scope, risk, or genuine irreproducibility/unpredictability, not merely by 'the cause isn't known yet' on its own. Examples: designing, changing, or building an architecture or a security/permissions/auth/payments/crypto system; a refactor spanning many files or crossing module boundaries; performance or concurrency problems; non-trivial algorithm design; planning how to build a nontrivial feature before writing code; open-ended design questions ('what's a good approach for X') about sensitive or architectural topics. ALWAYS heavy regardless of how few lines it takes to write: weakening, removing, disabling, or bypassing an existing security/access/auth control (e.g. removing a permission check, disabling certificate or signature verification, turning off CSRF/CORS protection, hardcoding or weakening a credential) — a one-line edit can still be a serious security regression, so line count never makes this quick or standard. Also always heavy: any bug, incident, or test failure that is INTERMITTENT, flaky, hard to reproduce, or production-only (e.g. 'fails 1 in 20 runs', 'can't reproduce it locally', 'intermittent in prod') — irreproducibility and intermittency are themselves strong evidence of real depth and are heavy the first time they're reported, they do not require a prior failed fix attempt as extra proof (a prior failed attempt is an even stronger signal, but its absence does not downgrade an already-intermittent/unreproducible problem to Standard).",
    capabilityRank: 3,
  },
  {
    id: "review",
    name: "Review / audit",
    description:
      "The PRIMARY thing being asked right now is to evaluate, check, judge, or audit a system or piece of work already presented as finished/existing (a diff, pull request, pasted code block, migration, config, design doc, or an already-built subsystem like 'our auth layer' or 'the payment flow') — not to diagnose unexplained live behavior, and not primarily to build, add, design, or substantially rework something (even if it also asks for a review afterward). This applies however simple or however technically sophisticated the reviewed thing is, and REGARDLESS of the topic: auditing an existing security/auth/permissions/crypto system for vulnerabilities is review, not heavy, even though building or redesigning that same kind of system would be heavy — the distinguishing question is always 'build/design it' (heavy) vs. 'check/audit/judge the one that already exists' (review), never the topic's sophistication. A one-line diff and a full cross-service security audit of a live system are both review. Recognize this by meaning, not just by trigger words — 'does this look right', 'could this lose data', 'is this safe to run', 'audit our X for vulnerabilities', and 'sanity-check this before I apply it' are all review even without the word 'review'; conversely, 'review the logs and find out why X crashes' is investigating unexplained live behavior (standard or heavy), not review, despite containing the word 'review' — there is no existing finished artifact being judged, only a live symptom being diagnosed.",
    capabilityRank: 3,
  },
]

/**
 * Used when Jev's confidence falls below the configured threshold. "standard"
 * is the safest fallback because most ambiguous/low-confidence requests are
 * ordinary work, not trivial edits or audits.
 */
export const DEFAULT_FALLBACK_CATEGORY_ID = "standard"
