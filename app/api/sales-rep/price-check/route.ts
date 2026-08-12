export const maxDuration = 60

import { NextResponse } from 'next/server'
import { client } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const itemCode = searchParams.get('item_code')?.trim().toUpperCase()
    const customerCode = searchParams.get('customer_code')?.trim()

    if (!itemCode) {
      return NextResponse.json(
        { error: 'item_code is required' },
        { status: 400 }
      )
    }

    // Fetch item details (includes stock + retail price)
    let item: any
    try {
      item = await client.items.get(itemCode)
    } catch (e: any) {
      if (e?.message?.includes('404')) {
        return NextResponse.json(
          { error: 'Item not found' },
          { status: 404 }
        )
      }
      throw e
    }

    // Fetch stock data
    let stockData: any = null
    try {
      stockData = await client.stock.get(itemCode)
    } catch {
      // Stock may not be available
    }

    const retailPrice = item?.price_list_price || item?.retail_price || item?.price || 0
    const canonicalCode = item?.canonical_code || item?.code || itemCode
    const canonicalName = item?.canonical_name || item?.name || item?.description || ''

    // Stock info
    const stockQty = stockData?.stock_qty ?? item?.stock_qty ?? 0
    const incomingQty = stockData?.incoming_qty ?? item?.incoming_qty ?? 0
    const orderedQty = stockData?.ordered_qty ?? item?.ordered_qty ?? 0

    // Per-warehouse breakdown, absorbed from the retired /stock/quick-check.
    // "Is it in stock" and "where is it" are the same question at the counter.
    //
    // FINAPI names the quantity `qty` here, NOT `stock_qty` — quick-check read
    // `stock_qty ?? quantity` and so rendered every warehouse as 0. `place` is
    // the shelf location, which is the whole point of asking per warehouse.
    const warehouses: Array<{
      warehouse: string; stock_qty: number; incoming_qty: number; ordered_qty: number; place: string | null
    }> = []
    if (Array.isArray(stockData?.warehouses)) {
      for (const wh of stockData.warehouses as Record<string, unknown>[]) {
        warehouses.push({
          warehouse: String(wh.warehouse ?? wh.warehouse_name ?? wh.name ?? 'ראשי'),
          stock_qty: Number(wh.qty ?? wh.stock_qty ?? wh.quantity ?? 0),
          incoming_qty: Number(wh.incoming_qty ?? 0),
          ordered_qty: Number(wh.ordered_qty ?? 0),
          place: (wh.place as string) || null,
        })
      }
    }

    // If customer code is provided, try to fetch customer-specific pricing
    let customerPrice: number | null = null
    let discount = 0

    if (customerCode) {
      try {
        const priceData = await client.prices.lookup(itemCode, { customer_code: customerCode })
        customerPrice = Number(priceData?.price || priceData?.customer_price) || null
        if (customerPrice && retailPrice > 0 && customerPrice < retailPrice) {
          discount = Math.round(((retailPrice - customerPrice) / retailPrice) * 100)
        }
      } catch {
        // Customer-specific pricing not available
      }
    }

    return NextResponse.json({
      item_code: canonicalCode,
      name: canonicalName,
      retail_price: retailPrice,
      customer_price: customerPrice,
      discount_pct: discount,
      stock_qty: stockQty,
      incoming_qty: incomingQty,
      ordered_qty: orderedQty,
      warehouses,
      in_stock: stockQty > 0,
    })
  } catch (error) {
    console.error('[sales-rep/price-check] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
