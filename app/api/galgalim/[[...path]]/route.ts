import { NextRequest, NextResponse } from 'next/server'
import { fetchSecretValue } from '@/lib/aws-secrets'
import { verifyJanSession, JAN_SESSION_COOKIE } from '@/lib/jan-sso'

export const dynamic = 'force-dynamic'

/**
 * /api/galgalim/* -> the Galgalim agent on the bots' host (192.168.0.231:8898), server side only, read-only.
 *
 * The agent (claude-work/galgalim/galgalim_agent.py) reads the halafim.galgalim.co.il trading floor every 15 min,
 * asks Diego v2 about each request and posts a staff card to the DiegoV2 Telegram group; this page is its log.
 * Same token and same session rule as /api/bots: the requests carry customers' plates and VINs.
 */
const GALGALIM_URL = process.env.GALGALIM_AGENT_URL || 'http://192.168.0.231:8898'
const ALLOWED: Record<string, string[]> = { requests: ['GET'], health: ['GET'], config: ['PUT'], run: ['POST'] }

async function authed(req: NextRequest): Promise<boolean> {
  const configured = !!(process.env.JAN_AUTH_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET)
  if (!configured) return true // same fail-open rule as middleware.ts
  return !!(await verifyJanSession(req.cookies.get(JAN_SESSION_COOKIE)?.value))
}

type Ctx = { params: Promise<{ path?: string[] }> }
// PUT /config {every_s} sets the polling interval, POST /run checks now (owner, 2026-10-05: "change the polling
// interval in the dashboard"); everything else is read-only.
async function proxy(req: NextRequest, { params }: Ctx, method: 'GET' | 'PUT' | 'POST') {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sub = ((await params).path ?? ['requests']).join('/')
  if (!ALLOWED[sub]?.includes(method)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const token = await fetchSecretValue('PARTLY_INTERNAL_API_KEY')
  if (!token) return NextResponse.json({ error: 'agent token not configured' }, { status: 500 })
  try {
    const res = await fetch(`${GALGALIM_URL}/${sub}${req.nextUrl.search}`, {
      method, headers: { 'X-Bot-Admin-Token': token, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : await req.text(), cache: 'no-store', signal: AbortSignal.timeout(20_000),
    })
    return new NextResponse(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  } catch (e) {
    return NextResponse.json({ error: `galgalim agent unreachable: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}
export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, ctx, 'GET') }
export async function PUT(req: NextRequest, ctx: Ctx) { return proxy(req, ctx, 'PUT') }
export async function POST(req: NextRequest, ctx: Ctx) { return proxy(req, ctx, 'POST') }
