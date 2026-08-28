export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getComparisonSnapshot } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

/**
 * GET /api/xpart/inquiries/[id]/comparison
 *
 * Xpart's own comparison snapshot, passed through. An inquiry with no snapshot
 * returns computed:false — the grid says "not computed yet" rather than drawing
 * an empty table that reads as "no supplier quoted anything".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const snapshot = await getComparisonSnapshot(id)

    if (!snapshot) {
      return NextResponse.json({
        computed: false,
        provenance: {
          source: 'unavailable',
          reason: 'ההשוואה לא חושבה עדיין ב‑Xpart',
        } satisfies Provenance,
      })
    }

    return NextResponse.json({
      computed: true,
      status: snapshot.status,
      computedAt: snapshot.computed_at,
      payload: snapshot.payload,
      provenance: {
        source: 'snapshot',
        asOf: snapshot.computed_at,
        // 'stale' is Xpart's own word for "the inputs moved since this was
        // built" — worth carrying through rather than presenting as current.
        scope: snapshot.status === 'fresh' ? 'Xpart' : `Xpart · ${snapshot.status}`,
      } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/comparison]', message)
    return NextResponse.json({
      computed: false,
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
