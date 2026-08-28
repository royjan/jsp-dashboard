export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getInquiryItems } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

/** GET /api/xpart/inquiries/[id]/items — the lines of one inquiry. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const items = await getInquiryItems(id, {
      search: searchParams.get('q') ?? undefined,
      limit: Number(searchParams.get('limit') ?? 200),
      offset: Number(searchParams.get('offset') ?? 0),
    })
    return NextResponse.json({
      items,
      provenance: { source: 'postgres', rows: items.length, scope: 'Xpart' } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/inquiry-items]', message)
    return NextResponse.json({
      items: [],
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
