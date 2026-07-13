import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { verifyPartSchemaViaPsa } from '@/lib/chat-admin/resolve-flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** POST /api/flow-decisions/verify-psa { partId, vin, expectedSchema? }
 *  Ground-truth check: what schema does PSA say this part belongs to on this VIN? */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const { partId, vin, expectedSchema } = await request.json()
    if (!partId) return NextResponse.json({ error: 'partId is required' }, { status: 400 })
    if (!vin) return NextResponse.json({ error: 'vin is required (decode a plate first)' }, { status: 400 })
    const res = await verifyPartSchemaViaPsa(partId, vin)
    const match = expectedSchema && res.schemas ? res.schemas.includes(expectedSchema) : undefined
    return NextResponse.json({ ...res, expectedSchema, match })
  } catch (error) {
    console.error('[flow-decisions/verify-psa] failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
