import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword } from '@/lib/auth/password-users'
import { createJanSession, JAN_SESSION_COOKIE, SESSION_DURATION, ALLOWED_DOMAIN } from '@/lib/jan-sso'

export const dynamic = 'force-dynamic'

/**
 * Cookie options that work both on the LAN (http://192.168.x:3002, an IP host) and on
 * https://dashboard.jan.parts. `secure` only over HTTPS; the shared `.jan.parts` domain
 * only when actually on that domain (a domain cookie can't be set for an IP host).
 */
function cookieOptions(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase()
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')
  const isHttps = proto === 'https'
  const onJanDomain = host.endsWith('.jan.parts')
  return {
    httpOnly: true as const,
    secure: isHttps,
    sameSite: 'lax' as const,
    maxAge: SESSION_DURATION,
    path: '/',
    ...(onJanDomain ? { domain: '.jan.parts' } : {}),
  }
}

/** POST /api/auth/password { email, password } → sets jan_session cookie on success. */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const user = verifyPassword(body.email || '', body.password || '')
  if (!user) {
    return NextResponse.json({ error: 'אימייל או סיסמה שגויים' }, { status: 401 })
  }
  let token: string
  try {
    token = await createJanSession({
      sub: user.email,
      email: user.email,
      name: user.name,
      picture: '',
      hd: ALLOWED_DOMAIN,
    })
  } catch {
    // JAN_AUTH_JWT_SECRET / JWT_SECRET / AUTH_SECRET not configured in the environment.
    return NextResponse.json({ error: 'שרת האימות אינו מוגדר (חסר מפתח חתימה)' }, { status: 500 })
  }
  const res = NextResponse.json({ ok: true, email: user.email, name: user.name })
  res.cookies.set({ name: JAN_SESSION_COOKIE, value: token, ...cookieOptions(req) })
  return res
}
