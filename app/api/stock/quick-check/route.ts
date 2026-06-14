import { NextResponse } from 'next/server'
import { client } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')?.trim().toUpperCase()

  if (!code) {
    return NextResponse.json({ error: 'code parameter required' }, { status: 400 })
  }

  try {
    await initializeSecrets()

    // Fetch item details, stock, price, and history chain in parallel
    const [item, history, stock, price] = await Promise.all([
      client.items.get(code).catch(() => null),
      client.items.getHistory(code).catch(() => null),
      client.stock.get(code).catch(() => null),
      client.prices.lookup(code).catch(() => null),
    ])

    if (!item) {
      return NextResponse.json({ error: 'Item not found', code }, { status: 404 })
    }

    const canonicalCode = history?.canonical_code || item.code
    const canonicalName = history?.canonical_name || item.name

    // Build warehouse breakdown from stock response
    const warehouses: Array<{
      warehouse: string
      stock_qty: number
      incoming_qty: number
      ordered_qty: number
    }> = []

    if (stock?.warehouses && Array.isArray(stock.warehouses)) {
      for (const wh of stock.warehouses as any[]) {
        warehouses.push({
          warehouse: String(wh.warehouse || wh.warehouse_name || wh.name || 'ראשי'),
          stock_qty: Number(wh.stock_qty ?? wh.quantity ?? 0),
          incoming_qty: Number(wh.incoming_qty ?? 0),
          ordered_qty: Number(wh.ordered_qty ?? 0),
        })
      }
    }

    // Total stock quantities
    const totalStock = item.stock_qty ?? stock?.stock_qty ?? 0
    const totalIncoming = item.incoming_qty ?? stock?.incoming_qty ?? 0
    const totalOrdered = item.ordered_qty ?? stock?.ordered_qty ?? 0

    // Price
    const retailPrice = price?.price_list_price ?? price?.price ?? item.price_list_price ?? item.price ?? null

    // History chain
    const historyChain: string[] = history?.item_id_history || item.item_id_history || []

    // Last sale info
    const lastSaleDate = item.last_sale_date || null
    const soldThisYear = item.sold_this_year ?? null
    const soldLastYear = item.sold_last_year ?? null

    return NextResponse.json({
      code: item.code,
      canonical_code: canonicalCode,
      canonical_name: canonicalName,
      description: item.long_description || item.name || null,
      stock_qty: totalStock,
      incoming_qty: totalIncoming,
      ordered_qty: totalOrdered,
      warehouses,
      retail_price: retailPrice,
      history_chain: historyChain,
      last_sale_date: lastSaleDate,
      sold_this_year: soldThisYear,
      sold_last_year: soldLastYear,
      place: item.place || null,
    })
  } catch (error) {
    console.error('[quick-check] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch item' },
      { status: 500 }
    )
  }
}
