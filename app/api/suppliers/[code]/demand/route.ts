export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { reorderQueue, supplierProfiles } from '@/lib/db/schema'
import { eq, sql, or, ilike } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getReorderRecommendations } from '@/lib/services/analytics-service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params
    const db = await getDb()

    // Get supplier profile to match items
    const profiles = await db
      .select()
      .from(supplierProfiles)
      .where(eq(supplierProfiles.supplierCode, code))
      .limit(1)

    const profile = profiles[0]

    // Get items in reorder queue that mention this supplier
    const queueItems = await db
      .select()
      .from(reorderQueue)
      .where(
        or(
          ilike(reorderQueue.supplierInfo, `%${code}%`),
          profile?.supplierName
            ? ilike(reorderQueue.supplierInfo, `%${profile.supplierName}%`)
            : undefined,
        )
      )

    // Also get general reorder recommendations for demand signals
    let recommendations: any[] = []
    try {
      recommendations = await getReorderRecommendations()
    } catch (e) {
      console.warn('[Suppliers] Failed to fetch reorder recommendations:', e)
    }

    // Combine: items in queue + high-urgency recommendations
    const demandItems = [
      ...queueItems.map(item => ({
        itemCode: item.itemCode,
        itemName: item.itemName,
        currentStock: item.currentStock,
        avgMonthlySales: Number(item.avgMonthlySales) || 0,
        suggestedQty: item.suggestedQty,
        urgencyScore: Number(item.urgencyScore) || 0,
        stage: item.stage,
        source: 'reorder_queue' as const,
      })),
      ...recommendations
        .filter(r => r.urgencyScore > 5)
        .slice(0, 50)
        .map(r => ({
          itemCode: r.code || r.item_code,
          itemName: r.name || r.item_name,
          currentStock: r.stock_qty || 0,
          avgMonthlySales: r.sold_this_year ? Math.round(r.sold_this_year / 12) : 0,
          suggestedQty: r.suggested_qty || Math.max(1, Math.ceil((r.sold_this_year || 0) / 4)),
          urgencyScore: r.urgencyScore || 0,
          stage: 'suggested',
          source: 'recommendation' as const,
        })),
    ]

    // Deduplicate by itemCode, prefer reorder_queue entries
    const seen = new Set<string>()
    const unique = demandItems.filter(item => {
      if (seen.has(item.itemCode)) return false
      seen.add(item.itemCode)
      return true
    })

    // Sort by urgency score descending
    unique.sort((a, b) => b.urgencyScore - a.urgencyScore)

    return NextResponse.json({
      items: unique,
      count: unique.length,
      supplierCode: code,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
