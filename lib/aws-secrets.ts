import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

interface AppSecrets {
  GEMINI_API_KEY?: string
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  FINANSIT_API_CREDENTIALS?: string
  [key: string]: string | undefined
}

let cachedSecrets: AppSecrets | null = null
let secretsCacheTimestamp: number | null = null
const SECRETS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export async function loadFromSecretsManager(): Promise<AppSecrets> {
  if (cachedSecrets && secretsCacheTimestamp) {
    const cacheAge = Date.now() - secretsCacheTimestamp
    if (cacheAge < SECRETS_CACHE_TTL_MS) {
      return cachedSecrets
    }
  }

  if (process.env.DISABLE_AWS === 'true') {
    const envSecrets: AppSecrets = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
      FINANSIT_API_CREDENTIALS: process.env.FINANSIT_API_CREDENTIALS,
    }
    cachedSecrets = envSecrets
    secretsCacheTimestamp = Date.now()
    return envSecrets
  }

  try {
    const clientConfig: Record<string, unknown> = {
      region: process.env.AWS_REGION || 'eu-central-1',
      maxAttempts: 2,
    }

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    }

    const client = new SecretsManagerClient(clientConfig)
    const response = await client.send(new GetSecretValueCommand({ SecretId: 'config' }))

    if (response.SecretString) {
      const secrets = JSON.parse(response.SecretString) as AppSecrets
      cachedSecrets = secrets
      secretsCacheTimestamp = Date.now()
      console.log(`[AWS Secrets] Loaded ${Object.keys(secrets).length} secrets`)
      return secrets
    }

    throw new Error('No secret string found')
  } catch (error) {
    console.warn(`[AWS Secrets] Failed: ${error}. Using env vars.`)
    const fallback: AppSecrets = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
      FINANSIT_API_CREDENTIALS: process.env.FINANSIT_API_CREDENTIALS,
    }
    cachedSecrets = fallback
    secretsCacheTimestamp = Date.now()
    return fallback
  }
}

export function getSecret(key: string, fallback: string = ''): string {
  if (cachedSecrets && cachedSecrets[key]) {
    return cachedSecrets[key]!
  }
  return process.env[key] || fallback
}

let secretsInitialized = false
let secretsInitPromise: Promise<AppSecrets> | null = null

export async function initializeSecrets(): Promise<AppSecrets> {
  if (secretsInitialized) return cachedSecrets || {}
  if (secretsInitPromise) return secretsInitPromise

  secretsInitPromise = (async () => {
    await loadFromSecretsManager()
    secretsInitialized = true
    return cachedSecrets || {}
  })()

  return secretsInitPromise
}
