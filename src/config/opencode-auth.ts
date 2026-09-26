import { existsSync, readFileSync } from "node:fs"
import { getOpencodeAuthPath } from "./paths"

interface ApiCredential {
  type: "api"
  key: string
}
interface OAuthCredential {
  type: "oauth"
  access?: string
  refresh?: string
  expires?: number
}
interface WellKnownCredential {
  type: "wellknown"
  key: string
  token?: string
}
type OpencodeAuthEntry = ApiCredential | OAuthCredential | WellKnownCredential

function readAuthFile(): Record<string, OpencodeAuthEntry> | undefined {
  const path = getOpencodeAuthPath()
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, OpencodeAuthEntry>
  } catch {
    return undefined
  }
}

/**
 * Reads OpenCode's own auth.json (read-only, never written) to reuse an API
 * key the user already entered via `opencode auth login`, so they don't have
 * to re-enter it for zenox-router. This is a direct filesystem read, not an
 * official plugin API — no official hook exposes another provider's stored
 * credential (confirmed via research; the same pattern is used in the wild
 * by opencode-9router-model-sync). See docs/implementation.md.
 *
 * Only `type: "api"` and `type: "wellknown"` entries are usable directly as
 * a bearer key. OAuth credentials (e.g. github-copilot) require a refresh
 * flow zenox-router does not implement, so those return undefined — the
 * user would need to add that provider's key to zenox-router's own
 * credential store instead.
 */
export function readOpencodeApiKey(providerID: string): string | undefined {
  const auth = readAuthFile()
  const entry = auth?.[providerID]
  if (!entry) return undefined
  if (entry.type === "api" || entry.type === "wellknown") return entry.key
  return undefined
}

/** Every provider ID OpenCode has *some* stored credential for (any type), for the setup wizard's auto-detect step. */
export function listOpencodeConfiguredProviders(): string[] {
  const auth = readAuthFile()
  return auth ? Object.keys(auth) : []
}
