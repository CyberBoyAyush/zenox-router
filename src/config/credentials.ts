import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs"
import { dirname } from "node:path"
import { z } from "zod"
import { getCredentialsPath } from "./paths"

const CredentialsSchema = z.object({
  /** OpenRouter (or TypeSafe-direct) key used only for Jev classification calls. */
  jevApiKey: z.string().optional(),
  /** providerID -> API key, for downstream models not already configured in OpenCode. */
  providerKeys: z.record(z.string(), z.string()).optional(),
})
export type Credentials = z.infer<typeof CredentialsSchema>

/** Never touches OpenCode's own auth.json — entirely separate file, entirely user-owned. */
export function loadCredentials(): Credentials {
  const path = getCredentialsPath()
  if (!existsSync(path)) return {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"))
    const parsed = CredentialsSchema.safeParse(raw)
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function saveCredentials(creds: Credentials): void {
  const path = getCredentialsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best-effort on platforms without POSIX permission bits (e.g. some Windows filesystems).
  }
}
