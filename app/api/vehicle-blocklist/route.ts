import { NextResponse } from 'next/server'
import { partlyFetch } from '@/lib/partly-internal'
import { forward, readBody, requireAdmin, requireReader } from '@/lib/vehicle-twins-proxy'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/vehicle-blocklist          → Partly's {entries, count} + {viewer}
 * GET  /api/vehicle-blocklist?vin=…    → Partly's per-provider test, unchanged
 * POST /api/vehicle-blocklist          → create (dashboard admins only; X-Acting-User = the signed-in email)
 */
export async function GET(req: Request) {
  const gate = await requireReader()
  if ('res' in gate) return gate.res
  const vin = new URL(req.url).searchParams.get('vin')?.trim()
  if (vin) return forward(`/api/vehicle-blocklist?vin=${encodeURIComponent(vin)}`)
  const { status, body } = await partlyFetch('/api/vehicle-blocklist')
  const payload = status < 300 && body && typeof body === 'object'
    ? { ...(body as Record<string, unknown>), viewer: { email: gate.viewer.email, canEdit: gate.viewer.canEdit } }
    : body ?? {}
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if ('res' in gate) return gate.res
  const parsed = await readBody(req)
  if ('res' in parsed) return parsed.res
  return forward('/api/vehicle-blocklist', { method: 'POST', body: parsed.body ?? {}, actingUser: gate.viewer.email })
}
