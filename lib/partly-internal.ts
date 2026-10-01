// SERVER ONLY — imported by route handlers, never by a client component.
import { cookies } from 'next/headers'
import { fetchSecretValue } from '@/lib/aws-secrets'
import { JAN_SESSION_COOKIE, verifyJanSession } from '@/lib/jan-sso'
import { isTwinAdmin, parseAdminList } from '@/lib/vehicle-twins'

/**
 * Server-side calls into Partly's internal API (the LAN container, not the
 * public host). The key never leaves this process: the browser talks to
 * /api/vehicle-twins/* here, which adds X-API-Key and, on writes,
 * X-Acting-User = the signed-in dashboard user.
 *
 *   PARTLY_INTERNAL_URL      default http://192.168.0.112:3001
 *   PARTLY_INTERNAL_API_KEY  env first, else the `config` Secrets Manager
 *                            secret (where partly keeps the same key)
 *   DASHBOARD_ADMIN_EMAILS   comma list; default roy@jan.co.il,avi@jan.co.il
 */
const BASE = (process.env.PARTLY_INTERNAL_URL || 'http://192.168.0.112:3001').replace(/\/$/, '')
const TIMEOUT_MS = 30_000

export interface Viewer { email: string | null; canEdit: boolean; authOn: boolean }

export async function currentViewer(): Promise<Viewer> {
  const authOn = !!(process.env.JAN_AUTH_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET)
  const token = (await cookies()).get(JAN_SESSION_COOKIE)?.value
  const session = authOn ? await verifyJanSession(token) : null
  const email = session?.email?.toLowerCase() ?? null
  return { email, canEdit: isTwinAdmin(email, parseAdminList(process.env.DASHBOARD_ADMIN_EMAILS)), authOn }
}

export interface PartlyResult { status: number; body: unknown }

export async function partlyFetch(
  path: string,
  init: { method?: string; body?: unknown; actingUser?: string | null; timeoutMs?: number } = {},
): Promise<PartlyResult> {
  const key = await fetchSecretValue('PARTLY_INTERNAL_API_KEY')
  if (!key) {
    return { status: 503, body: { error: 'PARTLY_INTERNAL_API_KEY is not configured on the dashboard' } }
  }
  const headers: Record<string, string> = { 'X-API-Key': key, Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.actingUser) headers['X-Acting-User'] = init.actingUser
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    })
    const text = await res.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = { error: text.slice(0, 500) } }
    return { status: res.status, body }
  } catch (e) {
    return { status: 502, body: { error: `Partly unreachable: ${e instanceof Error ? e.message : String(e)}` } }
  }
}
