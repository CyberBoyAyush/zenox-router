import type { CredentialSource } from "./schema"
import { readOpencodeApiKey } from "./opencode-auth"
import { loadCredentials } from "./credentials"

/**
 * Resolves the API key to use for a downstream provider's actual model call,
 * per the configured credentialSource policy. Never involved in resolving
 * the Jev/OpenRouter classification key — that's always credentials.jevApiKey.
 */
export function resolveProviderApiKey(providerID: string, source: CredentialSource): string | undefined {
  const own = loadCredentials().providerKeys?.[providerID]
  const opencode = readOpencodeApiKey(providerID)
  switch (source) {
    case "opencode-auth":
      return opencode
    case "own-store":
      return own
    case "both":
      return opencode ?? own
  }
}
