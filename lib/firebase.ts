/**
 * Firebase Admin bootstrap — two named apps for the delivery + shipments
 * Firestore projects. Ported from @jan/finansit-sdk's firebase.ts so the
 * dashboard reads the same data without depending on the SDK.
 *
 * Service-account JSON blobs are read from env vars first
 * (DELIVERY_GOOGLE_FIREBASE_JSON / SHIPMENT_STAGING_GOOGLE_FIREBASE_JSON — what
 * Dokploy injects), falling back to the shared `config` AWS Secrets Manager
 * secret.
 */
import { initializeApp, getApps, cert, type App, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const DELIVERY_APP = 'delivery-app'
const SHIPMENTS_APP = 'shipments-staging-app'
const DELIVERY_SECRET_KEY = 'DELIVERY_GOOGLE_FIREBASE_JSON'
// Warehouse receiving lives in the `countainer-staging` project — the same one
// finansit-sdk reads and the one countainer-next.web.app writes to. The older
// `SHIPMENT_GOOGLE_FIREBASE_JSON` key resolves to `countainer-7`, which stopped
// receiving on 2026-07-29 and has no `suppliers` registry; it is deliberately
// NOT a fallback here, because pointing at it fails silently — a valid project
// with an empty collection reads as "no shipments", never as an error.
const SHIPMENTS_SECRET_KEY = 'SHIPMENT_STAGING_GOOGLE_FIREBASE_JSON'

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
  // Which project a named app actually resolved to is not obvious — env var and
  // the `config` secret can disagree, and a wrong-but-valid project reads as an
  // empty collection rather than an error.
  console.log(`[firebase] ${appName} → project ${serviceAccount.project_id}`)
  return initializeApp({ credential: cert(serviceAccount as ServiceAccount) }, appName)
}

export async function getDeliveryFirestore(): Promise<Firestore> {
  return getFirestore(await initApp(DELIVERY_APP, DELIVERY_SECRET_KEY))
}

/** The `countainer-staging` project: shipments + the supplier registry. */
export async function getShipmentsFirestore(): Promise<Firestore> {
  return getFirestore(await initApp(SHIPMENTS_APP, SHIPMENTS_SECRET_KEY))
}

/**
 * Anything date-shaped → ISO string (or null).
 *
 * The container app writes date fields inconsistently: `shipmentDate` and
 * `createdAt` are an ISO string on older docs and a real Firestore Timestamp
 * on newer ones (in `countainer-staging`: 186 string vs 50 Timestamp as of
 * 2026-08-11). A Timestamp that has been through JSON — Redis, a cached API
 * response — arrives as a plain `{_seconds,_nanoseconds}` object with no
 * `toDate()`, so that shape has to be handled too or it silently becomes null.
 *
 * Normalise at every Firestore boundary: an un-normalised Timestamp serialises
 * to `{"_seconds":…}` and blows up any client doing `date.slice(0, 10)`.
 */
export function toIso(ts: unknown): string | null {
  if (ts == null) return null
  if (typeof ts === 'string') return ts || null
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts.toISOString()

  // Epoch seconds or milliseconds.
  if (typeof ts === 'number') {
    const ms = ts > 1e11 ? ts : ts * 1000
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  if (typeof ts !== 'object') return null

  // Live Timestamp instance.
  const withToDate = ts as { toDate?: () => Date }
  if (typeof withToDate.toDate === 'function') {
    try {
      const d = withToDate.toDate()
      return isNaN(d.getTime()) ? null : d.toISOString()
    } catch { return null }
  }

  // Timestamp that has been through JSON — admin SDK uses `_seconds`, the web
  // SDK and some exports use `seconds`.
  const plain = ts as { _seconds?: unknown; seconds?: unknown; _nanoseconds?: unknown; nanoseconds?: unknown }
  const secs = typeof plain._seconds === 'number' ? plain._seconds
    : typeof plain.seconds === 'number' ? plain.seconds
      : null
  if (secs !== null) {
    const nanos = typeof plain._nanoseconds === 'number' ? plain._nanoseconds
      : typeof plain.nanoseconds === 'number' ? plain.nanoseconds
        : 0
    const d = new Date(secs * 1000 + Math.floor(nanos / 1e6))
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  return null
}

/**
 * Sort key for a shipment-ish record. Falls back to `createdAt` when
 * `shipmentDate` is missing, and to '' so undated docs sort last rather than
 * throwing on comparison.
 */
export function dateSortKey(...candidates: unknown[]): string {
  for (const c of candidates) {
    const iso = toIso(c)
    if (iso) return iso
  }
  return ''
}
