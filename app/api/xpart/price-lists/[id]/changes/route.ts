export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getPriceChanges } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

const TYPES = ['increase', 'decrease', 'new', 'discontinued']

/** GET /api/xpart/price-lists/[id]/changes?type=&min= — rows behind a change tile. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')

    const changes = await getPriceChanges(id, {
      changeType: type && TYPES.includes(type) ? type : undefined,
      minAbsPct: Number(searchParams.get('min') ?? 0),
      limit: Number(searchParams.get('limit') ?? 200),
      offset: Number(searchParams.get('offset') ?? 0),
    })

    return NextResponse.json({
      changes,
      provenance: { source: 'postgres', rows: changes.length, scope: 'Xpart' } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/price-changes]', message)
    return NextResponse.json({
      changes: [],
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
