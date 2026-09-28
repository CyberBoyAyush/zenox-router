/**
 * Labeled evaluation set for the Jev classifier (see docs/implementation.md
 * for methodology). No prior OpenCode session history existed to mine real
 * queries from (checked via session_search/session_list — only this
 * planning session existed), so this set is hand-crafted to cover realistic
 * coding-agent traffic across all four default categories, including
 * deliberately ambiguous cases and a few multi-turn (recentContext) cases.
 */
export type ExpectedCategory = "quick" | "standard" | "heavy" | "review"

export interface EvalPrompt {
  id: string
  message: string
  recentContext?: string
  expected: ExpectedCategory
  /** Why this label was chosen — not sent to Jev, for human review of the eval only. */
  notes?: string
  /** Which slice of the eval this belongs to, for breakdown reporting. Defaults to "core" for this file. */
  set?: "core" | "stress" | "representative" | "fresh"
}

export const EVAL_PROMPTS: EvalPrompt[] = [
  // ───────────────────────────── quick ─────────────────────────────
  { id: "q1", message: "Fix this typo: 'recieve' should be 'receive' in the error message on line 42.", expected: "quick" },
  { id: "q2", message: "Rename the variable `usrNm` to `userName` throughout this file.", expected: "quick" },
  { id: "q3", message: "Can you run prettier on this file? The formatting is inconsistent.", expected: "quick" },
  { id: "q4", message: "What does the `??=` operator do in JavaScript?", expected: "quick" },
  { id: "q5", message: "Add a comment above this function explaining what it returns.", expected: "quick" },
  { id: "q6", message: "Change the port in the .env file from 3000 to 4000.", expected: "quick" },
  { id: "q7", message: "Is `Array.prototype.at(-1)` supported in Node 18?", expected: "quick" },
  { id: "q8", message: "Convert this JSON object to YAML.", expected: "quick" },
  { id: "q9", message: "Bump the version number in package.json to 1.2.4.", expected: "quick" },
  { id: "q10", message: "What's the difference between `let` and `const`?", expected: "quick" },
  { id: "q11", message: "This import is unused, remove it.", expected: "quick" },
  { id: "q12", message: "Capitalize the button label from 'submit' to 'Submit'.", expected: "quick" },
  { id: "q13", message: "What HTTP status code should I return for 'not authorized'?", expected: "quick" },
  { id: "q14", message: "Add a trailing comma to this array literal to match our style.", expected: "quick" },
  { id: "q15", message: "Quick one — what's the regex for a valid email address?", expected: "quick" },
  { id: "q16", message: "Sort this list of exports alphabetically.", expected: "quick" },
  { id: "q17", message: "Change the log level from debug to info in this line.", expected: "quick" },
  { id: "q18", message: "Does TypeScript support optional chaining on function calls?", expected: "quick" },
  { id: "q19", message: "Update the copyright year in the LICENSE file to 2026.", expected: "quick" },
  { id: "q20", message: "Add `.env` to the .gitignore file.", expected: "quick" },
  { id: "q21", message: "What's the npm command to check for outdated dependencies?", expected: "quick" },

  // ──────────────────────────── standard ────────────────────────────
  { id: "s1", message: "Add a `formatCurrency` utility function that takes a number and returns it formatted as USD.", expected: "quick", notes: "Relabeled after the first eval pass: this is exactly one Intl.NumberFormat call, no external input or design decision — genuinely quick, not standard." },
  { id: "s2", message: "The login form doesn't show an error when the password is too short — add that validation message.", expected: "standard" },
  { id: "s3", message: "Write unit tests for the `parseDate` function covering valid dates, invalid strings, and null input.", expected: "standard" },
  { id: "s4", message: "Add a loading spinner to the submit button while the form is being submitted.", expected: "standard" },
  { id: "s5", message: "Update the User model to add an optional `phoneNumber` field and update the migration.", expected: "standard" },
  { id: "s6", message: "Can you explain how the `useDebounce` hook in this file works?", expected: "standard" },
  { id: "s7", message: "Bump lodash to the latest version and fix any breaking changes.", expected: "standard" },
  { id: "s8", message: "Add pagination to the `/api/products` endpoint, 20 items per page.", expected: "standard" },
  { id: "s9", message: "Refactor this component to use the new `useAuth` hook instead of the old context.", expected: "standard" },
  { id: "s10", message: "There's a bug where clicking 'cancel' twice submits the form anyway — the button just isn't disabled on the second click, please fix.", expected: "standard" },
  { id: "s11", message: "Write a README section explaining how to run the tests locally.", expected: "standard" },
  { id: "s12", message: "Add a dark mode toggle that persists the choice in localStorage.", expected: "standard" },
  { id: "s13", message: "Create a new `Badge` component matching the style of the existing `Button` component.", expected: "standard" },
  { id: "s14", message: "The date picker shows dates in the wrong timezone — it should use the user's local timezone.", expected: "standard" },
  { id: "s15", message: "Add input sanitization to the search box so it strips HTML tags before sending the query.", expected: "standard" },
  { id: "s16", message: "Set up a basic GitHub Actions workflow that runs `npm test` on every push.", expected: "standard" },
  { id: "s17", message: "Extract this duplicated fetch logic in three components into a shared hook.", expected: "standard" },
  { id: "s18", message: "Add a confirmation dialog before deleting an item from the list.", expected: "standard" },
  { id: "s19", message: "The API returns dates as strings but the frontend expects Date objects — add the conversion.", expected: "standard" },
  { id: "s20", message: "Implement a simple in-memory cache for the `getConfig()` function so it doesn't re-read the file every call.", expected: "standard" },
  { id: "s21", message: "Add an `isEmpty` helper to check if an object has no own enumerable properties.", expected: "quick", notes: "Relabeled after the first eval pass: single well-known Object.keys(obj).length === 0 one-liner — genuinely quick, not standard." },
  { id: "s22", message: "Wire up the existing `Toast` component so it auto-dismisses after 5 seconds.", expected: "standard" },

  // ─────────────────────────────  heavy  ─────────────────────────────
  { id: "h1", message: "We need to migrate from REST to GraphQL for the product catalog service — help me design the schema and plan the migration in phases so we don't break the mobile app.", expected: "heavy" },
  { id: "h2", message: "I already tried adding a mutex around the cache write and it's still racing under load — there's some other shared state getting corrupted and I can't find it.", expected: "heavy" },
  { id: "h3", message: "Design the authorization model for a multi-tenant SaaS app where roles can be scoped per-workspace and permissions can be delegated temporarily.", expected: "heavy" },
  { id: "h4", message: "This refactor needs to touch the auth middleware, the session store, and every route handler that reads `req.user` — about 40 files. Plan the approach before we start.", expected: "heavy" },
  { id: "h5", message: "Production is throwing intermittent 502s under load and I can't reproduce it locally — walk me through how to diagnose this.", expected: "heavy" },
  { id: "h6", message: "The checkout flow needs to handle partial payment failures where the card charges but the order write fails — design the reconciliation strategy.", expected: "heavy" },
  { id: "h7", message: "Optimize this data pipeline — it currently takes 40 minutes on 10M rows and needs to run under 5.", expected: "heavy" },
  { id: "h8", message: "We're seeing a memory leak that only shows up after ~6 hours of uptime, heap snapshots aren't obviously pointing anywhere.", expected: "heavy" },
  { id: "h9", message: "Design a rate limiter that needs to work correctly across multiple server instances without a shared Redis, using something like a token-bucket approximation.", expected: "heavy" },
  { id: "h10", message: "I need to add end-to-end encryption for messages in this chat app — help me think through the key exchange and storage design.", expected: "heavy" },
  { id: "h11", message: "The test suite is flaky — about 1 in 20 runs, a totally unrelated test fails. I suspect shared state between test files but haven't confirmed it.", expected: "heavy" },
  { id: "h12", message: "Plan how to split this monolith into two services (billing and inventory) without downtime, including how we handle the shared database during the transition.", expected: "heavy" },
  { id: "h13", message: "There's a subtle off-by-one bug in the pagination logic that only shows up when the total count is an exact multiple of the page size — first attempt at a fix didn't hold up.", expected: "heavy" },
  { id: "h14", message: "Design the retry/backoff strategy for our webhook delivery system so it's resilient to downstream outages without hammering a struggling service.", expected: "heavy" },
  { id: "h15", message: "We need to support offline-first sync for the mobile app with conflict resolution when two devices edit the same record — figure out the approach.", expected: "heavy" },
  { id: "h16", message: "The build is nondeterministic — sometimes it passes, sometimes a completely different module fails to resolve, and I don't think it's a caching issue since I've cleared everything.", expected: "heavy" },
  { id: "h17", message: "Architect a plugin system for this editor so third parties can register custom commands and UI panels without touching core code.", expected: "heavy" },
  { id: "h18", message: "This SQL query works fine with 1k rows but times out with 2M — help me figure out why and redesign it.", expected: "heavy" },
  { id: "h19", message: "We need a strategy to roll out a breaking API change to 200k active clients without a hard cutover.", expected: "heavy" },
  { id: "h20", message: "The JWT refresh logic has a race condition where two tabs both refresh at once and one ends up with an invalid token — my first patch (a mutex in localStorage) didn't fully fix it.", expected: "heavy" },

  // ───────────────────────────── review ─────────────────────────────
  { id: "r1", message: "Can you review this diff before I open the PR? I want to make sure I'm not missing anything obvious.", expected: "review" },
  { id: "r2", message: "Review my authentication implementation for security issues — here's the diff.", expected: "review" },
  { id: "r3", message: "Take a look at this pull request and tell me if the error handling is solid.", expected: "review" },
  { id: "r4", message: "Self-review: I just implemented the payment webhook handler, check it for bugs before I ship it.", expected: "review" },
  { id: "r5", message: "Audit this codebase for common security vulnerabilities like SQL injection or XSS.", expected: "review" },
  { id: "r6", message: "Does this change introduce any regressions compared to the previous version of the function?", expected: "review" },
  { id: "r7", message: "I refactored the caching layer, can you check whether the cache invalidation logic still behaves correctly?", expected: "review" },
  { id: "r8", message: "Here's my teammate's PR — review it for code quality and consistency with our conventions.", expected: "review" },
  { id: "r9", message: "Double-check this database migration is safe to run on production — is it reversible?", expected: "review" },
  { id: "r10", message: "Review this design doc for the new notification system before we commit to it.", expected: "review" },
  { id: "r11", message: "I wrote this rate limiter myself, can you check it for edge cases I might have missed?", expected: "review" },
  { id: "r12", message: "Check whether this dependency update introduces any known CVEs.", expected: "review" },
  { id: "r13", message: "Look over this diff — did I handle the null case properly in the new validation logic?", expected: "review" },
  { id: "r14", message: "Review the access control changes in this PR against our least-privilege policy.", expected: "review" },
  { id: "r15", message: "Can you sanity-check this Terraform plan before I apply it?", expected: "review" },
  { id: "r16", message: "I just finished the refund flow — review it end to end before QA picks it up.", expected: "review" },
  { id: "r17", message: "Audit this GitHub Actions workflow for secrets that might be exposed in logs.", expected: "review" },

  // ─────────────────── ambiguous / boundary cases ───────────────────
  { id: "a1", message: "Fix the bug where the cart total is off by a cent on some orders.", expected: "standard", notes: "Sounds small, but rounding bugs in money math are a classic 'looks quick, is standard' case; no indication it's already resisted a fix, so standard not heavy." },
  { id: "a2", message: "Why is this function slow?", expected: "standard", notes: "Under-specified performance question without profiling context yet — starts as standard investigation, not yet a heavy optimization task." },
  { id: "a3", message: "This is broken again after your last fix, take another look.", expected: "heavy", notes: "A fix already failed once — classic escalation signal that should route to a stronger model." },
  { id: "a4", message: "Can you just double check my SQL query is correct before I run it against prod?", expected: "review", notes: "Framed as verifying existing work against a risky target (prod), not writing new work — review, despite being a single short query." },
  { id: "a5", message: "What's a good approach for adding two-factor authentication to this app?", expected: "heavy", notes: "Security-sensitive design question, open-ended 'what's a good approach' — planning/design, not a scoped implementation." },
  { id: "a6", message: "Add a `try/catch` around this fetch call so it doesn't crash the app on network errors.", expected: "quick", notes: "Small, mechanical, single well-known pattern, no design ambiguity — despite being 'error handling', which can sound heavier than it is." },
  { id: "a7", message: "Is this component re-rendering more than it should?", expected: "standard", notes: "Concrete, scoped performance question about one component — investigative but bounded, not a system-wide optimization." },
  { id: "a8", message: "One more pass on this PR — did we cover the edge case where the list is empty?", expected: "review", notes: "Explicitly a follow-up review pass on an existing PR." },

  // ─────────────────── multi-turn (recentContext) cases ───────────────────
  {
    id: "m1",
    recentContext: "User is implementing a Stripe webhook handler for subscription renewals.",
    message: "okay I think that's done, can you check it over before I merge?",
    expected: "review",
    notes: "Refers back to work just completed; the ask itself is a review request.",
  },
  {
    id: "m2",
    recentContext: "User and assistant just spent several turns debugging a race condition in the job queue; two proposed fixes did not resolve it.",
    message: "still happening, same as before",
    expected: "heavy",
    notes: "Short message, but recentContext shows repeated failed fix attempts on a concurrency bug — needs the stronger model despite terse phrasing.",
  },
  {
    id: "m3",
    recentContext: "User just asked for and received a new `slugify` utility function.",
    message: "cool, now also make one for titles that keeps the casing",
    expected: "quick",
    notes: "Trivial follow-on request in the same vein as a just-completed small utility.",
  },
  {
    id: "m4",
    recentContext: "User is planning a migration from a monolith to microservices, discussing service boundaries.",
    message: "what about the shared database, how do we handle that during the transition",
    expected: "heavy",
    notes: "Continuation of an architecture/migration planning discussion.",
  },
  {
    id: "m5",
    recentContext: "User pasted a 20-line diff implementing input validation for a signup form.",
    message: "does this look right to you?",
    expected: "review",
    notes: "Directly asking for judgment on pasted existing code.",
  },
]
