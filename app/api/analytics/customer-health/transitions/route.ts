export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { customerHealthTransitions } from '@/lib/db/schema'
import { desc, eq, and, or, sql } from 'drizzle-orm'

const BAND_ORDER: Record<string, number> = { green: 3, yellow: 2, red: 1 }

function isDeteriorating(from: string, to: string): boolean {
  return (BAND_ORDER[from] ?? 0) > (BAND_ORDER[to] ?? 0)
}

/**
 * GET /api/analytics/customer-health/transitions
 * Returns recent band transitions, filterable by direction.
 *
 * Query params:
 *   direction: 'deteriorating' | 'improving' | 'unacknowledged' | undefined (all)
 *   limit: number (default 50)
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const direction = searchParams.get('direction')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

    const db = await getDb()

    let conditions
    if (direction === 'unacknowledged') {
      conditions = eq(customerHealthTransitions.acknowledged, false)
    }

    const rows = await db
      .select()
      .from(customerHealthTransitions)
      .where(conditions)
      .orderBy(desc(customerHealthTransitions.createdAt))
      .limit(limit)

    // Filter by direction in JS (simpler than complex SQL for band ordering)
    let filtered = rows
    if (direction === 'deteriorating') {
      filtered = rows.filter(r => isDeteriorating(r.fromBand, r.toBand))
    } else if (direction === 'improving') {
      filtered = rows.filter(r => !isDeteriorating(r.fromBand, r.toBand))
    }

    // Count unacknowledged deteriorating for badge
    const unackDeteriorating = rows.filter(
      r => !r.acknowledged && isDeteriorating(r.fromBand, r.toBand)
    ).length

    // If we filtered above and need full count, query separately
    const unackCount = direction
      ? (await db
          .select({ count: sql<number>`count(*)` })
          .from(customerHealthTransitions)
          .where(
            and(
              eq(customerHealthTransitions.acknowledged, false),
              // deteriorating: from_band has higher order than to_band
              or(
                and(
                  eq(customerHealthTransitions.fromBand, 'green'),
                  or(
                    eq(customerHealthTransitions.toBand, 'yellow'),
                    eq(customerHealthTransitions.toBand, 'red')
                  )
                ),
                and(
                  eq(customerHealthTransitions.fromBand, 'yellow'),
                  eq(customerHealthTransitions.toBand, 'red')
                )
              )
            )
          ))[0]?.count ?? 0
      : unackDeteriorating

    return NextResponse.json({
      transitions: filtered,
      unacknowledgedDeterioratingCount: Number(unackCount),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/analytics/customer-health/transitions
 * Acknowledge a transition.
 *
 * Body: { id: string, acknowledged_by?: string, notes?: string }
 */
export async function PATCH(request: Request) {
  try {
    await initializeSecrets()
    const body = await request.json()
    const { id, acknowledged_by, notes } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const db = await getDb()
    await db
      .update(customerHealthTransitions)
      .set({
        acknowledged: true,
        acknowledgedBy: acknowledged_by || null,
        acknowledgedAt: new Date(),
        notes: notes || null,
      })
      .where(eq(customerHealthTransitions.id, id))

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
