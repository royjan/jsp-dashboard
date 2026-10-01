import { NextResponse } from 'next/server'
import { partlyFetch } from '@/lib/partly-internal'
import { forward, readBody, requireAdmin, requireReader } from '@/lib/vehicle-twins-proxy'

export const dynamic = 'force-dynamic'

/** Query params passed through to Partly; anything else is dropped. */
const PASS = ['vin', 'brand', 'model', 'year', 'powertrain', 'relation'] as const

/**
 * GET  /api/vehicle-twins            → Partly's {twins, count} + {viewer}
 * GET  /api/vehicle-twins?vin=…      → Partly's lookup answer, unchanged
 * POST /api/vehicle-twins            → create (dashboard admins only)
 */
export async function GET(req: Request) {
  const gate = await requireReader()
  if ('res' in gate) return gate.res
  const src = new URL(req.url).searchParams
  const qs = new URLSearchParams()
  for (const k of PASS) {
    const v = src.get(k)?.trim()
    if (v) qs.set(k, v)
  }
  const path = `/api/vehicle-twins${qs.size ? `?${qs}` : ''}`
  if (qs.size) return forward(path)
  const { status, body } = await partlyFetch(path)
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
  return forward('/api/vehicle-twins', { method: 'POST', body: parsed.body ?? {}, actingUser: gate.viewer.email })
}
