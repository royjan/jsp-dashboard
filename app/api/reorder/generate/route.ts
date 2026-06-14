export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getReorderRecommendations } from '@/lib/services/analytics-service'
import { getDb } from '@/lib/db'
import { reorderQueue } from '@/lib/db/schema'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function POST() {
  try {
    await initializeSecrets()
    const db = await getDb()

    // Get AI recommendations
    const recommendations = await getReorderRecommendations()

    // Get existing items in queue to avoid duplicates
    const existing = await db.select({ itemCode: reorderQueue.itemCode }).from(reorderQueue)
    const existingCodes = new Set(existing.map(e => e.itemCode))

    // Filter out items already in the queue
    const newItems = recommendations
      .filter(r => !existingCodes.has(r.code) && r.recommended_qty > 0)
      .slice(0, 100) // Limit to top 100 new suggestions

    if (newItems.length === 0) {
      return NextResponse.json({
        message: 'No new suggestions — all recommended items are already in the queue',
        added: 0,
      })
    }

    const inserted = await db.insert(reorderQueue).values(
      newItems.map(item => ({
        itemCode: item.code,
        itemName: item.name,
        suggestedQty: item.recommended_qty,
        currentStock: item.stock_qty,
        avgMonthlySales: String(Math.round((Math.max(item.sold_this_year, item.sold_last_year) / 12) * 10) / 10),
        stage: 'suggested' as const,
        urgencyScore: String(item.urgency_score),
        price: String(item.price),
      }))
    ).returning()

    return NextResponse.json({
      message: `Added ${inserted.length} new suggestions`,
      added: inserted.length,
      items: inserted,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate suggestions' },
      { status: 500 }
    )
  }
}
