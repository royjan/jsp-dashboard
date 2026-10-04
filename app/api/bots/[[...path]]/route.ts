import { NextRequest, NextResponse } from 'next/server'
import { fetchSecretValue } from '@/lib/aws-secrets'
import { verifyJanSession, JAN_SESSION_COOKIE } from '@/lib/jan-sso'

export const dynamic = 'force-dynamic'

/**
 * /api/bots/* -> bot-admin on the bots' host (192.168.0.231:8899), server side only.
 *
 * bot-admin owns the Diego demo bots' stats, limits and start/stop (see claude-work/bot-admin). Its token is the
 * internal API key this app already holds, so it never reaches a browser. /api is outside the page login gate
 * (middleware matcher), so this route checks the session itself: every call needs a signed-in user once auth is
 * configured — reads too, since the turn log holds customers' questions and phone numbers.
 */
const BOT_ADMIN_URL = process.env.BOT_ADMIN_URL || 'http://192.168.0.231:8899'
const ALLOWED = /^bots(\/[a-z0-9-]+(\/(stats|turns|policy|brands|telegram|start|stop|restart))?)?$/

async function authed(req: NextRequest): Promise<boolean> {
  const configured = !!(process.env.JAN_AUTH_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET)
  if (!configured) return true // same fail-open rule as middleware.ts: auth is off until its secret is set
  return !!(await verifyJanSession(req.cookies.get(JAN_SESSION_COOKIE)?.value))
}

async function proxy(req: NextRequest, path: string[], method: 'GET' | 'PUT' | 'POST') {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sub = ['bots', ...path].join('/')
  if (!ALLOWED.test(sub)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const token = await fetchSecretValue('PARTLY_INTERNAL_API_KEY')
  if (!token) return NextResponse.json({ error: 'bot-admin token not configured' }, { status: 500 })
  const url = `${BOT_ADMIN_URL}/${sub}${req.nextUrl.search}`
  try {
    const res = await fetch(url, {
      method,
      headers: { 'X-Bot-Admin-Token': token, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : await req.text(),
      cache: 'no-store',
      // start/restart run docker compose on the host: give them time
      signal: AbortSignal.timeout(method === 'GET' ? 30_000 : 600_000),
    })
    const body = await res.text()
    return new NextResponse(body, { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  } catch (e) {
    return NextResponse.json({ error: `bot-admin unreachable: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}

// OPTIONAL catch-all ([[...path]]): the list itself is /api/bots with no segment, which a plain [...path]
// does not match - the page got a 404 for its bot list on the first deploy (2026-10-04).
type Ctx = { params: Promise<{ path?: string[] }> }
export async function GET(req: NextRequest, { params }: Ctx) { return proxy(req, (await params).path ?? [], 'GET') }
export async function PUT(req: NextRequest, { params }: Ctx) { return proxy(req, (await params).path ?? [], 'PUT') }
export async function POST(req: NextRequest, { params }: Ctx) { return proxy(req, (await params).path ?? [], 'POST') }
