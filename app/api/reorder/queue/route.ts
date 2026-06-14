import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { reorderQueue } from '@/lib/db/schema'
import { initializeSecrets } from '@/lib/aws-secrets'
import { eq } from 'drizzle-orm'

export async function GET() {
  try {
    await initializeSecrets()
    const db = await getDb()
    const items = await db.select().from(reorderQueue)

    const grouped = {
      suggested: items.filter(i => i.stage === 'suggested'),
      approved: items.filter(i => i.stage === 'approved'),
      ordered: items.filter(i => i.stage === 'ordered'),
      received: items.filter(i => i.stage === 'received'),
    }

    return NextResponse.json(grouped)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch queue' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const body = await request.json()

    if (Array.isArray(body.items)) {
      const inserted = await db.insert(reorderQueue).values(
        body.items.map((item: any) => ({
          itemCode: item.itemCode || item.item_code || item.code,
          itemName: item.itemName || item.item_name || item.name,
          suggestedQty: item.suggestedQty || item.suggested_qty || item.recommended_qty || 0,
          currentStock: item.currentStock || item.current_stock || item.stock_qty || 0,
          avgMonthlySales: item.avgMonthlySales || item.avg_monthly_sales || null,
          stage: 'suggested' as const,
          supplierInfo: item.supplierInfo || item.supplier_info || null,
          notes: item.notes || null,
          urgencyScore: item.urgencyScore || item.urgency_score || null,
          price: item.price || null,
        }))
      ).returning()
      return NextResponse.json({ items: inserted, count: inserted.length })
    }

    return NextResponse.json({ error: 'Expected { items: [...] }' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add items' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { searchParams } = new URL(request.url)
    const stage = searchParams.get('stage')

    if (stage === 'received') {
      await db.delete(reorderQueue).where(eq(reorderQueue.stage, 'received'))
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Only stage=received can be bulk deleted' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear items' },
      { status: 500 }
    )
  }
}
