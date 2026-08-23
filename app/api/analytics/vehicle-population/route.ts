export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getCached, setCache } from '@/lib/redis-client'
import { getIcsStats } from '@/lib/ics-stats'

const CACHE_KEY = 'vehicle-population:summary:v3' // v3 adds total_manufacturers
const CACHE_TTL = 86400 // 24h

// National fleet age mix (Israel) — snapshot of the registration-year
// distribution. Computing this live means a full GROUP BY over the 3.7M-row
// ics."Vehicles" table, which takes >200s (and trips the DB statement_timeout),
// so we keep a stable snapshot and scale it to the live total. The mix shifts
// only slowly year-to-year; refresh the ratios occasionally if needed.
const AGE_MIX = [
  { bracket: '0-3 years', bracketHe: '0-3 שנים', minAge: 0, maxAge: 3, ratio: 755443 / 3720429 },
  { bracket: '3-7 years', bracketHe: '3-7 שנים', minAge: 3, maxAge: 7, ratio: 1150453 / 3720429 },
  { bracket: '7-12 years', bracketHe: '7-12 שנים', minAge: 7, maxAge: 12, ratio: 995844 / 3720429 },
  { bracket: '12+ years', bracketHe: '12+ שנים', minAge: 12, maxAge: 100, ratio: 818689 / 3720429 },
]

export async function GET() {
  try {
    await initializeSecrets()

    const cached = await getCached<any>(CACHE_KEY)
    if (cached) return NextResponse.json(cached)

    // Pre-aggregated, fast — same source the /market page uses. Was an HTTP
    // call to an ICS App Runner service that no longer exists; now one cached
    // scan of ics."Vehicles" in this same database. See lib/ics-stats.ts.
    const stats = await getIcsStats()
    // A cold cache is not a failure — getIcsStats() has just started the scan in
    // the background. Answer 200 with an empty payload and `warming`, so the
    // page shows its empty state instead of a red error, and NOTHING is cached:
    // the next request must be able to pick up the real numbers.
    if (!stats) {
      return NextResponse.json({
        total_vehicles: 0,
        total_manufacturers: 0,
        manufacturers: [],
        age_distribution: [],
        warming: true,
        cached_at: null,
      })
    }

    const total = Number(stats.overview?.totalVehicles) || 0
    const topModels: any[] = stats.topModels || []

    // Manufacturers (+ their top models) aggregated from topModels.
    const mfrMap = new Map<string, { manufacturer: string; count: number; models: { model: string; count: number }[] }>()
    for (const m of topModels) {
      const mfr = m.manufacturer || 'Unknown'
      if (!mfrMap.has(mfr)) mfrMap.set(mfr, { manufacturer: mfr, count: 0, models: [] })
      const e = mfrMap.get(mfr)!
      e.count += m.count || 0
      e.models.push({ model: m.model, count: m.count || 0 })
    }
    const manufacturers = Array.from(mfrMap.values())
      .map((e) => ({ ...e, models: e.models.sort((a, b) => b.count - a.count).slice(0, 15) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    const age_distribution = AGE_MIX.map((b) => ({
      bracket: b.bracket,
      bracketHe: b.bracketHe,
      minAge: b.minAge,
      maxAge: b.maxAge,
      count: Math.round(total * b.ratio),
    }))

    const response = {
      total_vehicles: total,
      // `manufacturers` is the TOP 20 for the chart; the KPI needs the real
      // count, which is 947 — reading it off the array made the card say 20.
      total_manufacturers: stats.overview.totalManufacturers,
      manufacturers,
      age_distribution,
      cached_at: new Date().toISOString(),
    }

    await setCache(CACHE_KEY, response, CACHE_TTL)
    return NextResponse.json(response)
  } catch (error) {
    console.error('[Vehicle Population] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch vehicle population data' },
      { status: 500 },
    )
  }
}
