import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { ebayRecommendations } from '@/lib/db/schema'
import { getItems } from '@/lib/services/analytics-service'

export async function GET() {
  try {
    const db = await getDb()
    const rows = await db
      .select({ itemCode: ebayRecommendations.itemCode })
      .from(ebayRecommendations)
      .where(eq(ebayRecommendations.status, 'pending'))

    return NextResponse.json({ items: rows.map(r => r.itemCode) })
  } catch (error) {
    console.error('[ebay/recommend] GET error:', error)
    return NextResponse.json({ items: [] })
  }
}

export async function POST(request: Request) {
  try {
    const { item_code, item_name, source = 'dashboard', reason } = await request.json()

    if (!item_code) {
      return NextResponse.json({ error: 'item_code is required' }, { status: 400 })
    }

    const db = await getDb()

    // Check if a pending recommendation already exists
    const existing = await db
      .select({ id: ebayRecommendations.id })
      .from(ebayRecommendations)
      .where(and(
        eq(ebayRecommendations.itemCode, item_code),
        eq(ebayRecommendations.status, 'pending'),
      ))
      .limit(1)

    if (existing.length > 0) {
      return NextResponse.json({ status: 'already_recommended', item_code })
    }

    // Enrich with live item data
    const rec: typeof ebayRecommendations.$inferInsert = {
      itemCode: item_code,
      itemName: item_name || null,
      source,
      reason: reason || 'Recommended from dashboard',
      status: 'pending',
      score: 50,
    }

    try {
      const items = await getItems()
      const item = items.find(i => i.code === item_code)
      if (item) {
        rec.itemName = rec.itemName || item.name
        rec.stockQty = item.stock_qty || 0
        rec.suggestedPriceIls = item.price || 0
        rec.soldThisYear = item.sold_this_year || 0
        rec.soldLastYear = item.sold_last_year || 0
        rec.sold2yAgo = item.sold_2y_ago || 0
        rec.sold3yAgo = item.sold_3y_ago || 0
        rec.incomingQty = item.incoming_qty || 0
        rec.orderedQty = item.ordered_qty || 0
        rec.oldItemId = item.old_item_id || null
        rec.newItemId = item.new_item_id || null
        rec.itemIdHistory = item.item_id_history ? JSON.stringify(item.item_id_history) : '[]'
      }
    } catch (e) {
      console.warn('[ebay/recommend] Failed to enrich item data:', e)
    }

    await db.insert(ebayRecommendations).values(rec)

    return NextResponse.json({ status: 'recommended', item_code })
  } catch (error) {
    console.error('[ebay/recommend] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to recommend' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const itemCode = searchParams.get('item_code')

    if (!itemCode) {
      return NextResponse.json({ error: 'item_code is required' }, { status: 400 })
    }

    const db = await getDb()
    await db
      .delete(ebayRecommendations)
      .where(and(
        eq(ebayRecommendations.itemCode, itemCode),
        eq(ebayRecommendations.status, 'pending'),
      ))

    return NextResponse.json({ status: 'removed', item_code: itemCode })
  } catch (error) {
    console.error('[ebay/recommend] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove' },
      { status: 500 }
    )
  }
}
