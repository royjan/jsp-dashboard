export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getPriceListItems, type PriceListItemSort } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

const SORTS: PriceListItemSort[] = ['part_number', 'brand_name', 'price', 'cost_ils']

/**
 * GET /api/xpart/price-lists/[id]/items
 *
 * Server-side search, sort and paging over the whole list — ARG's is 492k rows,
 * so nothing here is sliced in the browser.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const sortParam = searchParams.get('sort') as PriceListItemSort | null

    const items = await getPriceListItems(id, {
      search: searchParams.get('q') ?? undefined,
      sort: sortParam && SORTS.includes(sortParam) ? sortParam : 'part_number',
      dir: searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
      limit: Number(searchParams.get('limit') ?? 50),
      offset: Number(searchParams.get('offset') ?? 0),
    })

    return NextResponse.json({
      items,
      provenance: { source: 'postgres', rows: items.length, scope: 'Xpart' } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/price-list-items]', message)
    return NextResponse.json({
      items: [],
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
