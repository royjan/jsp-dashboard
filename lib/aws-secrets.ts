/**
 * AWS Secrets Manager — thin wrapper around @jan/aws-secrets
 *
 * Keeps the same synchronous getSecret() signature used throughout the project.
 * Callers must await initializeSecrets() once at startup before using getSecret().
 *
 * In local dev where @jan/aws-secrets is unavailable, falls back to process.env.
 */

interface AppSecrets {
  GEMINI_API_KEY?: string
  FINANSIT_API_CREDENTIALS?: string
  CRON_SECRET?: string
  [key: string]: string | undefined
}

/** Local reference to the fetched secrets so getSecret() can remain synchronous. */
let cachedSecrets: Record<string, string> = {}

/** Dynamically import @jan/aws-secrets (only available in production via CodeArtifact). */
async function loadAwsModule() {
  try {
    return await import('@jan/aws-secrets')
  } catch {
    return null
  }
}

export async function loadFromSecretsManager(): Promise<AppSecrets> {
  const mod = await loadAwsModule()
  if (mod) {
    cachedSecrets = await mod.getSecrets()
  }
  return cachedSecrets as AppSecrets
}

export function getSecret(key: string, fallback: string = ''): string {
  if (cachedSecrets[key]) return cachedSecrets[key]
  return process.env[key] || fallback
}

let secretsInitPromise: Promise<AppSecrets> | null = null

export async function initializeSecrets(): Promise<AppSecrets> {
  if (secretsInitPromise) return secretsInitPromise

  secretsInitPromise = (async () => {
    const mod = await loadAwsModule()
    if (mod) {
      await mod.initSecrets()
      cachedSecrets = await mod.getSecrets()
    }
    return cachedSecrets as AppSecrets
  })()

  return secretsInitPromise
}
