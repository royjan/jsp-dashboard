import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { resolveFlowByPartId } from '@/lib/chat-admin/resolve-flow'

export const dynamic = 'force-dynamic'
// The PSA fallback navigates the live catalog (cold session up to ~90s).
export const maxDuration = 120

/** POST /api/flow-decisions/resolve-path { partId, vin? } → { found, category, subcategory, schema, ... } */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const body = await request.json().catch(() => ({}))
    const partId = (body?.partId || '').toString().trim()
    if (!partId) return NextResponse.json({ error: 'partId is required' }, { status: 400 })
    const res = await resolveFlowByPartId(partId, body?.vin)
    return NextResponse.json(res)
  } catch (error) {
    console.error('[flow-decisions/resolve-path] failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'resolve failed' }, { status: 500 })
  }
}
