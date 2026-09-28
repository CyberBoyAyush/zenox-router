import * as p from "@clack/prompts"
import pc from "picocolors"
import { DEFAULT_CATEGORIES, DEFAULT_FALLBACK_CATEGORY_ID } from "../jev/categories"
import type { Category, RouterConfig, CredentialSource } from "../config/schema"
import { saveGlobalRouterConfig, loadRouterConfig } from "../config/store"
import { saveCredentials, loadCredentials } from "../config/credentials"
import { listOpencodeConfiguredProviders } from "../config/opencode-auth"
import { fetchModelsDevCatalog, flattenCatalog, listProviders, filterByProvider, type FlatModel } from "../modelsdev/client"
import { ensurePluginInstalled } from "./opencode-config"

interface WizardOptions {
  isUpdate: boolean
}

export async function runSetup(options: WizardOptions = { isUpdate: false }): Promise<void> {
  p.intro(pc.cyan(options.isUpdate ? "zenox-router — reconfigure" : "zenox-router setup"))

  const existing = loadRouterConfig(process.cwd())
  const existingCreds = loadCredentials()

  // ── 1. Jev / OpenRouter key ──
  const jevKey = await p.password({
    message: "OpenRouter API key (used only for Jev classification — https://openrouter.ai/keys)",
    validate: (v) => (v.trim().length === 0 && !existingCreds.jevApiKey ? "Required" : undefined),
  })
  if (p.isCancel(jevKey)) return cancel()
  if (jevKey.trim()) {
    saveCredentials({ ...existingCreds, jevApiKey: jevKey.trim() })
  } else if (!existingCreds.jevApiKey) {
    p.log.error("No OpenRouter key provided and none stored — cannot continue.")
    return
  }

  // ── 2. Detect providers already configured in OpenCode ──
  const configuredProviders = listOpencodeConfiguredProviders()
  if (configuredProviders.length > 0) {
    p.note(`Already configured in OpenCode: ${configuredProviders.join(", ")}\nzenox-router will reuse these credentials automatically.`, "Detected providers")
  }

  // ── 3. Fetch models.dev catalog ──
  const spinner = p.spinner()
  spinner.start("Fetching models.dev catalog")
  const catalog = await fetchModelsDevCatalog({ forceRefresh: options.isUpdate })
  const allModels = flattenCatalog(catalog)
  spinner.stop(`Loaded ${allModels.length} models across ${listProviders(catalog).length} providers`)

  // ── 4. Build categories ──
  const categories: Category[] = []
  const existingById = new Map((existing?.categories ?? []).map((c) => [c.id, c]))

  for (const def of DEFAULT_CATEGORIES) {
    p.note(def.description, def.name)
    const include = await p.confirm({ message: `Configure "${def.name}"?`, initialValue: true })
    if (p.isCancel(include)) return cancel()
    if (!include) continue

    const cascade = await pickCascade(allModels, catalog, existingById.get(def.id)?.cascade)
    if (cascade === null) return cancel()
    if (cascade.length === 0) {
      p.log.warn(`Skipping "${def.name}" — no models selected.`)
      continue
    }
    categories.push({ id: def.id, name: def.name, description: def.description, cascade, capabilityRank: existingById.get(def.id)?.capabilityRank ?? defaultRank(def.id) })
  }

  // ── 5. Optional fully-custom categories ──
  while (await confirmAddCustomCategory()) {
    const custom = await buildCustomCategory(allModels, catalog)
    if (custom === null) return cancel()
    if (custom) categories.push(custom)
  }

  if (categories.length === 0) {
    p.log.error("No categories configured — nothing to save.")
    return
  }

  // ── 6. Default category + confidence threshold ──
  const defaultCategoryId = await p.select({
    message: "Fallback category when Jev's confidence is low",
    options: categories.map((c) => ({ value: c.id, label: c.name })),
    initialValue: categories.some((c) => c.id === DEFAULT_FALLBACK_CATEGORY_ID) ? DEFAULT_FALLBACK_CATEGORY_ID : categories[0]!.id,
  })
  if (p.isCancel(defaultCategoryId)) return cancel()

  // ── 7. Credential source ──
  const credentialSource = await p.select<CredentialSource>({
    message: "Where should zenox-router get API keys for the real models it routes to?",
    options: [
      { value: "both", label: "OpenCode's own auth + zenox-router's store (recommended)", hint: "reuses opencode auth login" },
      { value: "opencode-auth", label: "OpenCode's auth only" },
      { value: "own-store", label: "zenox-router's own store only" },
    ],
    initialValue: existing?.credentialSource ?? "both",
  })
  if (p.isCancel(credentialSource)) return cancel()

  // ── 8. Optional budget ──
  const wantsBudget = await p.confirm({ message: "Set a global spend budget (safety cap)?", initialValue: false })
  if (p.isCancel(wantsBudget)) return cancel()
  let budget: RouterConfig["budget"]
  if (wantsBudget) {
    const dailyUsd = await p.text({ message: "Daily budget in USD (leave blank for no daily cap)", placeholder: "e.g. 5" })
    if (p.isCancel(dailyUsd)) return cancel()
    const monthlyUsd = await p.text({ message: "Monthly budget in USD (leave blank for no monthly cap)", placeholder: "e.g. 100" })
    if (p.isCancel(monthlyUsd)) return cancel()
    budget = {
      dailyUsd: dailyUsd.trim() ? Number(dailyUsd) : undefined,
      monthlyUsd: monthlyUsd.trim() ? Number(monthlyUsd) : undefined,
    }
  }

  // ── 9. Any missing credentials for chosen models? ──
  await collectMissingCredentials(categories, configuredProviders, credentialSource)

  const config: RouterConfig = {
    categories,
    defaultCategoryId,
    confidenceThreshold: existing?.confidenceThreshold ?? 0.5,
    budget,
    credentialSource,
    recentContextChars: existing?.recentContextChars ?? 600,
    customModelLimits: existing?.customModelLimits ?? {},
  }

  saveGlobalRouterConfig(config)
  p.log.success("Saved zenox-router config")

  const install = await ensurePluginInstalled(process.cwd())
  if (install.alreadyInstalled) p.log.info(`zenox-router already registered in ${install.path}`)
  else p.log.success(`Registered zenox-router in ${install.path}`)

  p.outro(pc.green('Done! Select "Zenox Router" as your model in OpenCode.'))
}

function defaultRank(categoryId: string): number {
  return DEFAULT_CATEGORIES.find((c) => c.id === categoryId)?.capabilityRank ?? 1
}

async function confirmAddCustomCategory(): Promise<boolean> {
  const result = await p.confirm({ message: "Add a custom category?", initialValue: false })
  return !p.isCancel(result) && result
}

async function buildCustomCategory(allModels: FlatModel[], catalog: Awaited<ReturnType<typeof fetchModelsDevCatalog>>): Promise<Category | null | false> {
  const id = await p.text({ message: "Category id (lowercase, no spaces)", validate: (v) => (/^[a-z0-9_-]+$/.test(v) ? undefined : "lowercase letters/numbers/-/_ only") })
  if (p.isCancel(id)) return null
  const name = await p.text({ message: "Display name", initialValue: id })
  if (p.isCancel(name)) return null
  const description = await p.text({ message: "Description (sent to Jev as this category's criteria — be specific)" })
  if (p.isCancel(description)) return null
  const cascade = await pickCascade(allModels, catalog)
  if (cascade === null) return null
  if (cascade.length === 0) {
    p.log.warn("No models selected — category not added.")
    return false
  }
  const rankStr = await p.select({
    message: "Capability rank (for cross-category fallback — higher = tried first when downgrading elsewhere)",
    options: [
      { value: "0", label: "Low (like Quick)" },
      { value: "1", label: "Medium (like Standard)" },
      { value: "3", label: "High (like Heavy/Review)" },
    ],
    initialValue: "1",
  })
  if (p.isCancel(rankStr)) return null
  return { id, name, description, cascade, capabilityRank: Number(rankStr) }
}

/** Loops: pick a provider, multiselect its models, repeat, or enter a custom model ref with manual limits. Returns null on cancel. */
async function pickCascade(allModels: FlatModel[], catalog: Awaited<ReturnType<typeof fetchModelsDevCatalog>>, existingCascade?: string[]): Promise<string[] | null> {
  const cascade: string[] = [...(existingCascade ?? [])]
  void catalog

  for (;;) {
    const action = await p.select({
      message: cascade.length > 0 ? `Cascade so far: ${cascade.join(" \u2192 ")}` : "Build this category's model cascade (fallback order)",
      options: [
        { value: "provider", label: "Search by provider", hint: "browse models.dev by provider" },
        { value: "search", label: "Search all models", hint: "free text across every provider" },
        { value: "custom", label: "Enter a custom model", hint: "not in models.dev — you'll enter limits manually" },
        { value: "done", label: cascade.length > 0 ? "Done with this category" : "Skip this category", hint: cascade.length > 0 ? undefined : "no models selected" },
      ],
    })
    if (p.isCancel(action)) return null
    if (action === "done") return cascade

    if (action === "provider") {
      const providers = listProviders(await catalog).map((pr) => ({ value: pr.id, label: `${pr.name} (${pr.modelCount})` }))
      const providerId = await p.select({ message: "Provider", options: providers })
      if (p.isCancel(providerId)) return null
      const models = filterByProvider(allModels, providerId)
      const picked = await p.multiselect({
        message: "Models (space to select, enter to confirm)",
        options: models.map((m) => ({ value: m.ref, label: m.modelName, hint: `${formatContext(m.context)} ctx, $${m.costInput}/$${m.costOutput} per M` })),
        required: false,
      })
      if (p.isCancel(picked)) return null
      cascade.push(...picked.filter((ref) => !cascade.includes(ref)))
      continue
    }

    if (action === "search") {
      const query = await p.text({ message: "Search (model or provider name)" })
      if (p.isCancel(query)) return null
      const { searchModels } = await import("../modelsdev/client")
      const results = searchModels(allModels, query).slice(0, 40)
      if (results.length === 0) {
        p.log.warn("No matches")
        continue
      }
      const picked = await p.multiselect({
        message: "Models",
        options: results.map((m) => ({ value: m.ref, label: `${m.ref}`, hint: `${formatContext(m.context)} ctx` })),
        required: false,
      })
      if (p.isCancel(picked)) return null
      cascade.push(...picked.filter((ref) => !cascade.includes(ref)))
      continue
    }

    if (action === "custom") {
      const ref = await p.text({ message: "Model ref (provider/model, e.g. my-provider/my-model)", validate: (v) => (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/-]+$/.test(v) ? undefined : "must be provider/model") })
      if (p.isCancel(ref)) return null
      if (!cascade.includes(ref)) cascade.push(ref)
      continue
    }
  }
}

function formatContext(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}

async function collectMissingCredentials(categories: Category[], configuredProviders: string[], source: CredentialSource): Promise<void> {
  if (source === "opencode-auth") return // user explicitly chose to only use OpenCode's auth — nothing for us to collect
  const providers = new Set<string>()
  for (const c of categories) for (const ref of c.cascade) providers.add(ref.split("/")[0] ?? "")

  const creds = loadCredentials()
  const missing = [...providers].filter((id) => id && !configuredProviders.includes(id) && !creds.providerKeys?.[id])
  if (missing.length === 0) return

  p.note(`These providers aren't configured in OpenCode yet: ${missing.join(", ")}`, "Missing credentials")
  const providerKeys = { ...(creds.providerKeys ?? {}) }
  for (const providerId of missing) {
    const key = await p.password({ message: `API key for ${providerId} (leave blank to add later)` })
    if (p.isCancel(key) || !key.trim()) continue
    providerKeys[providerId] = key.trim()
  }
  saveCredentials({ ...creds, providerKeys })
}

function cancel(): void {
  p.cancel("Setup cancelled")
}
