/**
 * Firebase Admin bootstrap — two named apps for the delivery + shipments
 * Firestore projects. Ported from @jan/finansit-sdk's firebase.ts so the
 * dashboard reads the same data without depending on the SDK.
 *
 * Service-account JSON blobs are read from env vars first
 * (DELIVERY_GOOGLE_FIREBASE_JSON / SHIPMENT_GOOGLE_FIREBASE_JSON — what Dokploy
 * injects), falling back to the shared `config` AWS Secrets Manager secret.
 */
import { initializeApp, getApps, cert, type App, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const DELIVERY_APP = 'delivery-app'
const SHIPMENTS_APP = 'shipments-app'
const DELIVERY_SECRET_KEY = 'DELIVERY_GOOGLE_FIREBASE_JSON'
const SHIPMENTS_SECRET_KEY = 'SHIPMENT_GOOGLE_FIREBASE_JSON'

let _configCache: Record<string, string> | null = null

async function loadConfigSecrets(): Promise<Record<string, string>> {
  if (_configCache) return _configCache
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
    const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || 'eu-central-1' })
    const res = await sm.send(new GetSecretValueCommand({ SecretId: 'config' }))
    _configCache = JSON.parse(res.SecretString || '{}')
  } catch (e) {
    console.warn('[firebase] could not load `config` AWS secret (using env only):', e instanceof Error ? e.message : e)
    return {}
  }
  return _configCache!
}

// Tolerant parse for service-account blobs stored with raw newlines/tabs.
function parseServiceAccount(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw) } catch {
    try { return JSON.parse(raw.replace(/\r\n|\n|\r/g, '\\n').replace(/\t/g, '\\t')) } catch { return null }
  }
}

async function resolveCredential(secretKey: string): Promise<Record<string, unknown> | null> {
  const fromEnv = process.env[secretKey]
  if (fromEnv) return parseServiceAccount(fromEnv)
  const secrets = await loadConfigSecrets()
  const raw = secrets[secretKey]
  if (!raw) return null
  return typeof raw === 'string' ? parseServiceAccount(raw) : (raw as Record<string, unknown>)
}

async function initApp(appName: string, secretKey: string): Promise<App> {
  const existing = getApps().find((a) => a?.name === appName)
  if (existing) return existing
  const serviceAccount = await resolveCredential(secretKey)
  if (!serviceAccount) {
    throw new Error(`Firebase credential not found for ${appName}: set ${secretKey} in env or the 'config' AWS secret`)
  }
  return initializeApp({ credential: cert(serviceAccount as ServiceAccount) }, appName)
}

export async function getDeliveryFirestore(): Promise<Firestore> {
  return getFirestore(await initApp(DELIVERY_APP, DELIVERY_SECRET_KEY))
}

export async function getShipmentsFirestore(): Promise<Firestore> {
  return getFirestore(await initApp(SHIPMENTS_APP, SHIPMENTS_SECRET_KEY))
}

/** Timestamp | ISO-string | Date → ISO string (or null). */
export function toIso(ts: unknown): string | null {
  if (!ts) return null
  if (typeof ts === 'string') return ts
  const maybe = ts as { toDate?: () => Date }
  if (maybe && typeof maybe.toDate === 'function') {
    try { return maybe.toDate().toISOString() } catch { return null }
  }
  if (ts instanceof Date) return ts.toISOString()
  return null
}
