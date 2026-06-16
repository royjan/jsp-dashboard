/**
 * AWS Secrets Manager loader (no @jan/aws-secrets / CodeArtifact).
 *
 * Uses @aws-sdk/client-secrets-manager directly. Set APP_SECRETS_ID (or
 * AWS_SECRETS_ID) to the Secrets Manager secret holding a JSON blob of app
 * secrets; without it (e.g. the Dokploy deploy, which injects env vars
 * directly) this is a no-op and getSecret() reads process.env.
 *
 * getSecret() stays synchronous — callers await initializeSecrets() once at
 * startup, then read synchronously.
 */

interface AppSecrets {
  GEMINI_API_KEY?: string
  FINANSIT_API_CREDENTIALS?: string
  CRON_SECRET?: string
  [key: string]: string | undefined
}

/** Local reference to fetched secrets so getSecret() can stay synchronous. */
let cachedSecrets: Record<string, string> = {}

export async function loadFromSecretsManager(): Promise<AppSecrets> {
  const secretId = process.env.APP_SECRETS_ID || process.env.AWS_SECRETS_ID
  if (!secretId) return cachedSecrets as AppSecrets // env-only (no SM configured)
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'eu-central-1' })
    const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
    if (res.SecretString) {
      cachedSecrets = { ...cachedSecrets, ...JSON.parse(res.SecretString) }
    }
  } catch (e) {
    console.warn('[aws-secrets] Secrets Manager load failed, falling back to env:', e instanceof Error ? e.message : e)
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
  secretsInitPromise = loadFromSecretsManager()
  return secretsInitPromise
}
