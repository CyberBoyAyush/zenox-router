import { z } from "zod"
import { CATEGORY_PRECEDENCE_RULE } from "./categories"

/**
 * The only shape classifyRequest actually needs. Both CategoryDefinition
 * (built-in wording) and the full config Category (src/config/schema.ts,
 * which adds cascade/budget/etc.) structurally satisfy this, so either can
 * be passed here directly with no conversion.
 */
export interface ClassificationCriterion {
  id: string
  description: string
}

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
const JEV_MODEL = "typesafe/jev-1.13"

const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
})

const DecisionsResponse = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  answers: z.object({
    category: ChoiceAnswer,
  }),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
})

export interface ClassificationResult {
  categoryId: string
  confidence: number
  probabilities: Record<string, number>
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
  raw: unknown
}

export class JevClassificationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = "JevClassificationError"
  }
}

/** The instructions Jev receives for the single `category` choice question. */
const CATEGORY_INSTRUCTIONS =
  "Classify the developer's LATEST request into exactly one category, based on the nature and difficulty of the work being asked for right now — not on how it is phrased, its length, or the difficulty of the codebase in general. If the request references earlier conversation, use `recent_context` only to understand what it refers to; classify the request itself. " +
  CATEGORY_PRECEDENCE_RULE

export interface ClassifyInput {
  /** The user's latest message (what to classify). */
  message: string
  /** A short digest of recent turns, purely for disambiguating references. Optional. */
  recentContext?: string
  categories: ClassificationCriterion[]
  apiKey: string
  /** Abort/timeout in ms. Defaults to 15s — Jev is fast, this should rarely trip. */
  timeoutMs?: number
}

export async function classifyRequest(input: ClassifyInput): Promise<ClassificationResult> {
  const { message, recentContext, categories, apiKey, timeoutMs = 15_000 } = input

  const criteria: Record<string, string> = {}
  for (const category of categories) {
    criteria[category.id] = category.description
  }

  const state: Record<string, string> = { message }
  if (recentContext) state.recent_context = recentContext

  const body = {
    model: JEV_MODEL,
    state,
    questions: {
      category: {
        type: "choice" as const,
        instructions: CATEGORY_INSTRUCTIONS,
        criteria,
      },
    },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "zenox-router",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    throw new JevClassificationError(
      `Jev request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()
  if (!response.ok) {
    throw new JevClassificationError(`Jev returned HTTP ${response.status}: ${text}`, response.status, text)
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new JevClassificationError(`Jev returned invalid JSON: ${text}`)
  }

  const parsed = DecisionsResponse.safeParse(json)
  if (!parsed.success) {
    throw new JevClassificationError(`Jev returned an unexpected shape: ${parsed.error.message}`, response.status, json)
  }

  const { choice, confidence, probabilities } = parsed.data.answers.category
  const usage = parsed.data.usage

  return {
    categoryId: choice,
    confidence: confidence ?? 0,
    probabilities: probabilities ?? {},
    usage: {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      costUsd: usage?.cost ?? 0,
    },
    raw: json,
  }
}
