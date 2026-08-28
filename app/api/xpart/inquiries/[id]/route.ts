export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getInquiry, getResponseCoverage } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

/** GET /api/xpart/inquiries/[id] — header plus per-supplier response coverage. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const inquiry = await getInquiry(id)
    if (!inquiry) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const coverage = await getResponseCoverage(id)

    return NextResponse.json({
      inquiry,
      coverage,
      provenance: {
        source: 'postgres',
        scope: 'Xpart',
        asOf: inquiry.created_at,
      } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/inquiry]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
