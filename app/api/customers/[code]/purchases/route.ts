export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'
import { getCanonicalizer, foldByChain } from '@/lib/services/analytics-service'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params
    const { searchParams } = new URL(request.url)
    const days = Math.min(Number(searchParams.get('days') || '90'), 365)

    // FINAPI: GET /api/customers/{code}/purchases?days=N
    // Returns per-item aggregates: item_code, item_name, total_qty, total_value,
    // line_count, last_purchased, returned_qty (active year only).
    const data = await (client as any).get(
      `/api/customers/${encodeURIComponent(code)}/purchases`,
      { days }
    )

    // FOLD THE CHAIN. FINAPI aggregates by the code that was on the line, so a customer
    // who bought the same physical part before and after it was re-coded gets two rows —
    // two names, two quantities, neither of them what they bought. The customer page ranks
    // these rows, so the split also pushes a top part down the list twice.
    const items = Array.isArray(data?.items) ? data.items : []
    if (items.length > 0) {
      const canon = await getCanonicalizer().catch(() => null)
      if (canon) {
        data.items = foldByChain(items, canon, {
          codeField: 'item_code',
          sum: ['total_qty', 'total_value', 'line_count', 'returned_qty', 'returned_value'],
          max: ['last_purchased'],
          longest: ['item_name'],
          aliasField: 'alias_codes',
        }).sort((a: any, b: any) => (Number(b.total_value) || 0) - (Number(a.total_value) || 0))
        // `item_count` is what the page prints as "how many different parts".
        data.item_count = data.items.length
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[customer purchases]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', items: [] },
      { status: 500 }
    )
  }
}
