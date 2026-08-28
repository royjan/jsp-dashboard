export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getPriceListDetail } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

/** GET /api/xpart/price-lists/[id] — header, FX rate and the four change counts. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const detail = await getPriceListDetail(id)
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 })

    return NextResponse.json({
      ...detail,
      provenance: {
        source: 'postgres',
        scope: 'Xpart',
        asOf: detail.effective_date ?? undefined,
      } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/price-list]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
