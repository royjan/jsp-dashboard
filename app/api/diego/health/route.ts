import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { diegoHealthSignals } from '@/lib/chat-admin/diego-sessions'

export const dynamic = 'force-dynamic'

/** The v3 stack's actual hosts (LAN) — overridable per environment. */
const SERVICES = [
  { key: 'adk', label: 'ADK', url: process.env.DIEGO_ADK_HEALTH_URL ?? 'http://192.168.0.230:8000/list-apps' },
  { key: 'ingest', label: 'WA ingest', url: process.env.DIEGO_INGEST_HEALTH_URL ?? 'http://192.168.0.230:8767/' },
  { key: 'portal', label: 'portal-pilot', url: process.env.PORTAL_PILOT_HEALTH_URL ?? 'http://192.168.0.179:3200/health' },
]

/** Any HTTP response (even 404) means the service is up; only connection failures count as down. */
async function ping(url: string, timeoutMs = 2500): Promise<'up' | 'down'> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    return 'up'
  } catch {
    return 'down'
  }
}

/**
 * GET /api/diego/health — "is Diego answering right now?"
 * Live pings of the v3 stack (adk web, WA ingest, portal-pilot) + signals derived
 * from diego_v3 itself (last-event age, 24h turns/errors, avg answer latency).
 */
export async function GET() {
  try {
    await initializeSecrets()
    const [signals, ...pings] = await Promise.all([
      diegoHealthSignals().catch(() => null),
      ...SERVICES.map((s) => ping(s.url)),
    ])
    const services = SERVICES.map((s, i) => ({ key: s.key, label: s.label, status: pings[i] }))
    return NextResponse.json({ success: true, services, signals })
  } catch (e) {
    console.error('[diego/health]', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
