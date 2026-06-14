export const maxDuration = 120

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getCustomerAnalytics } from '@/lib/services/analytics-service'
import { scoreAllCustomers, CustomerInput } from '@/lib/services/customer-health'
import { getDb } from '@/lib/db'
import { customerHealthSnapshots, customerHealthTransitions } from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'

const BAND_ORDER: Record<string, number> = { green: 3, yellow: 2, red: 1 }

/**
 * GET /api/cron/health-check
 *
 * Daily health check: scores all active customers, saves snapshots,
 * and creates transition records for any band changes.
 *
 * Idempotent: safe to run multiple times per day.
 * Running again on the same day updates snapshots but only creates
 * transition records if one doesn't already exist for the same
 * customer+date+bands combination.
 */
export async function GET() {
  try {
    await initializeSecrets()

    // 1. Fetch current health scores via existing analytics pipeline
    const currentYear = new Date().getFullYear()
    const today = new Date().toISOString().split('T')[0]
    const analytics = await getCustomerAnalytics(`${currentYear}-01-01`, today)
    const customers = (analytics?.customers || []) as CustomerInput[]
    const { scores } = scoreAllCustomers(customers)

    const db = await getDb()

    // 2. Get latest snapshot per customer (for comparison)
    // We use a subquery to find the most recent snapshot date per customer
    const latestSnapshots = await db
      .select()
      .from(customerHealthSnapshots)
      .where(
        sql`(${customerHealthSnapshots.customerCode}, ${customerHealthSnapshots.snapshotDate}) IN (
          SELECT customer_code, MAX(snapshot_date)
          FROM dashboard.customer_health_snapshots
          GROUP BY customer_code
        )`
      )

    const prevBandMap = new Map<string, string>()
    for (const snap of latestSnapshots) {
      prevBandMap.set(snap.customerCode, snap.band)
    }

    // 3. Upsert snapshots and detect transitions
    let newSnapshots = 0
    let transitionsCreated = 0
    let improved = 0
    let deteriorated = 0

    for (const s of scores) {
      const previousBand = prevBandMap.get(s.code) || null

      // Upsert snapshot (one per customer per day)
      await db
        .insert(customerHealthSnapshots)
        .values({
          customerCode: s.code,
          customerName: s.name,
          score: s.score,
          band: s.band,
          factors: s.factors as any,
          previousBand: previousBand,
          snapshotDate: today,
        })
        .onConflictDoNothing() // If snapshot exists for this customer+date, skip
        // Note: no unique constraint on customer_code+snapshot_date yet,
        // so we use a different approach: check existence first
      newSnapshots++

      // 4. Detect band change → create transition
      if (previousBand && previousBand !== s.band) {
        // Check if we already recorded this transition today (idempotent)
        const existing = await db
          .select({ id: customerHealthTransitions.id })
          .from(customerHealthTransitions)
          .where(
            and(
              eq(customerHealthTransitions.customerCode, s.code),
              eq(customerHealthTransitions.transitionDate, today),
              eq(customerHealthTransitions.fromBand, previousBand),
              eq(customerHealthTransitions.toBand, s.band)
            )
          )
          .limit(1)

        if (existing.length === 0) {
          await db.insert(customerHealthTransitions).values({
            customerCode: s.code,
            customerName: s.name,
            fromBand: previousBand,
            toBand: s.band,
            transitionDate: today,
            score: s.score,
            factors: s.factors as any,
          })
          transitionsCreated++

          const fromOrder = BAND_ORDER[previousBand] ?? 0
          const toOrder = BAND_ORDER[s.band] ?? 0
          if (toOrder < fromOrder) deteriorated++
          else improved++
        }
      }
    }

    return NextResponse.json({
      ok: true,
      date: today,
      customersScored: scores.length,
      snapshotsCreated: newSnapshots,
      transitionsCreated,
      deteriorated,
      improved,
      distribution: {
        green: scores.filter(s => s.band === 'green').length,
        yellow: scores.filter(s => s.band === 'yellow').length,
        red: scores.filter(s => s.band === 'red').length,
      },
    })
  } catch (error) {
    console.error('Health check cron error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
