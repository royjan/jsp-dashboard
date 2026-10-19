import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'
import { JAN_SESSION_COOKIE, verifyJanSession } from '@/lib/jan-sso'

/**
 * The gate shared by the routes that change the `config` secret: a signed-in
 * dashboard session to read, plus the settings password to change anything.
 *
 * The password is the SETTINGS_EDIT_PASSWORD environment variable (set on the
 * Dokploy app); with it unset, editing is off. It is not in the source on
 * purpose: the repository is on GitHub. Failed attempts are rate-limited per
 * address across every route that uses this gate.
 */

const MAX_ATTEMPTS = 5
const WINDOW_MS = 10 * 60 * 1000
const attempts = new Map<string, { n: number; until: number }>()

export const editingEnabled = (): boolean => !!process.env.SETTINGS_EDIT_PASSWORD

/** The signed-in email, '' when auth is off (no signing secret configured), or null when not signed in. */
export async function sessionEmail(): Promise<string | null> {
  // Mirrors middleware.ts: with no signing secret configured, auth is off everywhere.
  const configured = !!(process.env.JAN_AUTH_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET)
  if (!configured) return ''
  const token = (await cookies()).get(JAN_SESSION_COOKIE)?.value
  const session = await verifyJanSession(token)
  return session ? session.email : null
}

export type PasswordCheck = { ok: true } | { ok: false; status: 403 | 429; error: string }

/** Constant-time check of the settings password, rate-limited per address. */
export function checkEditPassword(req: Request, given: unknown): PasswordCheck {
  const expected = process.env.SETTINGS_EDIT_PASSWORD || ''
  if (!expected) return { ok: false, status: 403, error: 'editing is off: SETTINGS_EDIT_PASSWORD is not set' }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const now = Date.now()
  const a = attempts.get(ip)
  if (a && a.n >= MAX_ATTEMPTS && a.until > now) return { ok: false, status: 429, error: 'too many attempts, try again later' }
  const x = Buffer.from(String(given ?? ''), 'utf8')
  const y = Buffer.from(expected, 'utf8')
  if (x.length === y.length && timingSafeEqual(x, y)) {
    attempts.delete(ip)
    return { ok: true }
  }
  const cur = a && a.until > now ? a : { n: 0, until: now + WINDOW_MS }
  attempts.set(ip, { n: cur.n + 1, until: cur.until })
  return { ok: false, status: 403, error: 'wrong password' }
}
