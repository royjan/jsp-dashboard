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

/**
 * Read one key straight out of a Secrets Manager secret, on demand.
 *
 * The deploy does not set APP_SECRETS_ID, so loadFromSecretsManager() is a
 * no-op and getSecret() only ever sees the env vars Dokploy injects. The
 * container does carry AWS credentials, though, and the "config" secret holds
 * everything — so a key that is in Secrets Manager but not in the injected env
 * is reachable, just not by the path above.
 *
 * Why not simply default APP_SECRETS_ID to "config": that would pull the whole
 * secret in, including CRON_SECRET, which would immediately start gating every
 * /api/cron/* route. The jan-box systemd timers call those without a bearer
 * token and would begin failing. Opening that up is a deliberate decision with
 * its own rollout, not a side effect of wanting one connection string.
 *
 * Result is cached in the same map getSecret() reads, so this costs one API
 * call per process.
 */
export async function fetchSecretValue(key: string, secretId = 'config'): Promise<string> {
  if (cachedSecrets[key]) return cachedSecrets[key]
  if (process.env[key]) return process.env[key]!
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'eu-central-1' })
    const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
    if (res.SecretString) {
      const parsed = JSON.parse(res.SecretString) as Record<string, string>
      cachedSecrets = { ...cachedSecrets, ...parsed }
      return parsed[key] ?? ''
    }
  } catch (e) {
    console.warn(`[aws-secrets] could not read ${key} from ${secretId}:`, e instanceof Error ? e.message : e)
  }
  return ''
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
