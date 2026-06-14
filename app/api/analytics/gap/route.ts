export const maxDuration = 120

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '200', 10)
    const format = searchParams.get('format') || '31' // quotes by default

    // Use the dedicated gap analysis endpoint (server-side Redis join)
    // Returns: { filters, total_quoted_items, gap_count, items: GapItem[] }
    // GapItem: { item_code, item_name, times_quoted, total_qty_quoted, last_quoted_date, stock_qty, ordered_qty, incoming_qty }
    const data = await client.analytics.gap({
      doc_format: format,
      require_zero_stock: true,
      require_zero_incoming: true,
      limit,
    })

    const raw = data as any
    const gapItems: any[] = raw?.items || []

    const items = gapItems.map((item: any) => ({
      item_code: item.item_code,
      name: item.item_name || item.item_code,
      total_qty: item.total_qty_quoted ?? 0,
      total_value: 0, // gap endpoint doesn't include price, just quantity
      quote_count: item.times_quoted ?? 0,
      customer_count: item.times_quoted ?? 0, // approximation: each quote line ~ 1 customer
      last_quoted: item.last_quoted_date ?? '',
      stock_qty: item.stock_qty ?? 0,
      incoming_qty: item.incoming_qty ?? 0,
      ordered_qty: item.ordered_qty ?? 0,
    }))

    return NextResponse.json({
      items,
      count: raw?.gap_count ?? items.length,
      total_quoted_items: raw?.total_quoted_items ?? 0,
      total_lost_qty: items.reduce((s: number, i: any) => s + i.total_qty, 0),
    })
  } catch (error) {
    console.error('[gap] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
