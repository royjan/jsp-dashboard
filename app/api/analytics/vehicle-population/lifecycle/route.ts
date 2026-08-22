export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems, getCanonicalizer, getCategorizer } from '@/lib/services/analytics-service'
import { query, slowQuery } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

// v2: real part-type categories (erp.item_categories) instead of one ⁧ללא קטגוריה⁩ series.
const CACHE_KEY = 'vehicle-population:lifecycle:v2'
const CACHE_TTL = 86400 // 24h

const AGE_KEY = 'vehicle-population:age-dist:v1'
const AGE_TTL = 86400 // a day; registrations move slower than that
let ageRefreshInflight: Promise<void> | null = null

/** Cached vehicle-age histogram. Empty map = not warm yet; a refresh is now running. */
async function ageDistribution(currentYear: number): Promise<Map<number, number>> {
  const cached = await getCached<Array<[number, number]>>(AGE_KEY)
  if (cached?.length) return new Map(cached.map(([a, c]) => [Number(a), Number(c)]))
  refreshAgeDistribution(currentYear)
  return new Map()
}

function refreshAgeDistribution(currentYear: number): void {
  if (ageRefreshInflight) return
  ageRefreshInflight = (async () => {
    const t0 = Date.now()
    // SARGABLE, unlike the version this replaces: a plain range on the column itself, so
    // the day someone adds the index it is used without touching this file again.
    const res = await slowQuery(
      `SELECT date_part('year', "registrationDate")::int AS year,
              SUM(COALESCE(quantity, 1))                 AS count
         FROM ics."Vehicles"
        WHERE "registrationDate" >= make_date($1, 1, 1)
          AND "registrationDate" <  make_date($2, 1, 1)
        GROUP BY 1`,
      [currentYear - 15, currentYear + 1],
    )
    const pairs: Array<[number, number]> = res.rows.map((r: any) => [
      currentYear - Number(r.year), Number(r.count) || 0,
    ])
    if (pairs.length > 0) await setCache(AGE_KEY, pairs, AGE_TTL)
    console.log(`[Vehicle Lifecycle] age distribution warmed: ${pairs.length} years in ${Date.now() - t0}ms`)
  })().catch((e) => {
    console.warn('[Vehicle Lifecycle] age distribution refresh failed:', e?.message?.slice(0, 140))
  }).finally(() => { ageRefreshInflight = null })
}

/**
 * Vehicle lifecycle analysis: shows which maintenance items peak at which vehicle age.
 * Based on when parts are most commonly sold relative to vehicle registration year.
 *
 * Returns: age brackets (0-15 years) with top parts categories and estimated demand intensity.
 */
export async function GET() {
  try {
    await initializeSecrets()

    const cached = await getCached<any>(CACHE_KEY)
    if (cached) return NextResponse.json(cached)

    const currentYear = new Date().getFullYear()

    // Parts categories with their sales volumes, categorised from the LIVE catalogue.
    //
    // The category used to come from a LEFT JOIN on dashboard.item_snapshots, which
    // cannot supply one: its newest rows are from 2026-03-21 (811 of 4,266 selling
    // items) and its `category` is the EMPTY STRING on 2,664 of 2,668 rows. COALESCE
    // replaces NULL, not '', so every series on this chart was the same blank category.
    // The ERP's own classification (erp.item_categories, group 2 = ⁧סוג החלק⁩) answers first;
    // the item's `group` field is a '0000' placeholder for most of the catalogue and only
    // ever produced one unnamed series here.
    const categoryOf = await getCategorizer()
    const catByCode = new Map<string, string>()
    for (const it of await getItems()) {
      const code = String(it.code ?? '').toUpperCase()
      if (code) catByCode.set(code, categoryOf(code, it))
    }
    // catByCode is keyed by CANONICAL code, monthly_sales by the raw code on the
    // document. Without this fold every superseded code missed the map and its
    // revenue landed in the no-category bucket, while also counting as a second
    // "unique item".
    const canon = await getCanonicalizer()
    const catFor = (code: string) =>
      catByCode.get(canon(String(code || '')).toUpperCase())
    const monthlyRows = await query(`
      SELECT item_code, year, month,
             SUM(quantity::numeric) as qty,
             SUM(revenue::numeric)  as rev
      FROM dashboard.monthly_sales
      WHERE year >= $1
      GROUP BY item_code, year, month
    `, [currentYear - 3])
    const cells = new Map<string, any>()
    for (const r of monthlyRows.rows as any[]) {
      const cat = catFor(r.item_code) || 'אחר'
      const key = `${cat}|${r.year}|${r.month}`
      const c = cells.get(key) || { category: cat, year: r.year, month: r.month, qty: 0, rev: 0 }
      c.qty += Number(r.qty) || 0
      c.rev += Number(r.rev) || 0
      cells.set(key, c)
    }
    const categorySalesResult = {
      rows: [...cells.values()]
        .filter(c => c.qty > 0)
        .sort((a, b) => String(a.category).localeCompare(String(b.category))
          || a.year - b.year || a.month - b.month),
    }

    // Aggregate by category
    const categoryTotals = new Map<string, number>()
    for (const row of categorySalesResult.rows) {
      const cat = row.category as string
      categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + Number(row.qty))
    }

    // Top 12 categories by volume
    const topCategories = Array.from(categoryTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([cat]) => cat)

    // Vehicle age distribution for normalization — CACHED, and refreshed off the request.
    //
    // This used to run inline and it could not succeed: 3.78M rows in ics."Vehicles", no
    // index on `registrationDate` alone, and `EXTRACT(YEAR FROM ...)` in the WHERE clause,
    // which cannot use one anyway. 40.1s measured (EXPLAIN ANALYZE) against a 30s pool
    // timeout and a 30s route budget, so every uncached request returned
    // `{"error":"Query read timeout"}`. The page looked alive only because a payload cached
    // before this route grew its current shape was still being served.
    //
    // So the aggregate is warmed in the background and kept for a day — it changes at most
    // daily — and a request that finds it missing answers WITHOUT age normalization and says
    // so, rather than 500ing. `ONE INDEX on ics."Vehicles"("registrationDate")` would make
    // this a sub-second inline query again; until then this is the honest shape.
    const ageDistMap = await ageDistribution(currentYear)
    const ageDataReady = ageDistMap.size > 0

    // Build lifecycle heatmap data
    // Each cell: [vehicle_age, parts_category] -> demand intensity
    // We use domain knowledge for the lifecycle patterns since direct correlation
    // requires VIN-level matching which we don't have.
    const lifecyclePatterns: Record<string, number[]> = {}

    // Default lifecycle curve (peaks around 7-10 years)
    const defaultCurve = [0.1, 0.15, 0.2, 0.3, 0.5, 0.6, 0.75, 0.9, 1.0, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5]

    // Category-specific lifecycle curves (0-15 years)
    const knownPatterns: Record<string, number[]> = {
      // Filters peak early and stay constant
      'filters': [0.3, 0.6, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5],
      'oil': [0.3, 0.6, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5],
      // Brakes peak at 4-8 years
      'brake': [0.05, 0.1, 0.2, 0.5, 0.8, 1.0, 1.0, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5, 0.4],
      // Timing belts peak at 5-8 years
      'timing': [0.0, 0.0, 0.05, 0.1, 0.3, 0.7, 1.0, 1.0, 0.8, 0.5, 0.3, 0.2, 0.15, 0.1, 0.05, 0.05],
      // Suspension peaks at 6-10 years
      'suspension': [0.0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.0, 0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4],
      // Clutch peaks at 7-11 years
      'clutch': [0.0, 0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.0, 1.0, 0.9, 0.8, 0.6, 0.4, 0.3, 0.2],
      // AC peaks in summer vehicles 3-8 years
      'ac': [0.1, 0.2, 0.3, 0.5, 0.8, 1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15],
      'cooling': [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0, 1.0, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4],
      // Electrical issues increase with age
      'electric': [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.0, 0.95, 0.9],
      // Exhaust peaks 8-12 years
      'exhaust': [0.0, 0.0, 0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5],
    }

    for (const category of topCategories) {
      const catLower = category.toLowerCase()
      let curve = defaultCurve

      for (const [pattern, patternCurve] of Object.entries(knownPatterns)) {
        if (catLower.includes(pattern)) {
          curve = patternCurve
          break
        }
      }

      // Scale by actual sales volume
      const totalSales = categoryTotals.get(category) || 1
      lifecyclePatterns[category] = curve.map((v, age) => {
        const vehiclesAtAge = ageDistMap.get(age) || 1
        // intensity = pattern curve * sales volume factor * vehicle population weight
        return Math.round(v * (totalSales / 1000) * (vehiclesAtAge / 10000) * 100) / 100
      })
    }

    // Normalize each category to 0-1 range for heatmap
    const heatmapData: Array<{
      category: string
      ages: Array<{ age: number; intensity: number; rawValue: number }>
    }> = []

    for (const category of topCategories) {
      const values = lifecyclePatterns[category] || defaultCurve
      const max = Math.max(...values, 0.001)

      heatmapData.push({
        category,
        ages: values.map((v, age) => ({
          age,
          intensity: Math.round((v / max) * 100) / 100,
          rawValue: v,
        })),
      })
    }

    // Peak analysis: for each category, when does demand peak?
    const peakAnalysis = heatmapData.map(cat => {
      const peakAge = cat.ages.reduce((max, curr) => curr.intensity > max.intensity ? curr : max, cat.ages[0])
      return {
        category: cat.category,
        peak_age: peakAge.age,
        peak_intensity: peakAge.intensity,
        total_sales: categoryTotals.get(cat.category) || 0,
      }
    })

    const response = {
      heatmap: heatmapData,
      peak_analysis: peakAnalysis.sort((a, b) => a.peak_age - b.peak_age),
      age_distribution: Array.from(ageDistMap.entries())
        .map(([age, count]) => ({ age, count }))
        .sort((a, b) => a.age - b.age),
      total_categories: topCategories.length,
      // SAY WHICH HALF IS MISSING. Without the vehicle histogram the intensities are the
      // shape of the maintenance curves alone, not scaled to how many cars are that age —
      // a reader cannot tell that from the numbers, so the payload says it.
      age_data_ready: ageDataReady,
      note_he: ageDataReady
        ? 'הערכה מבוססת על דפוסי תחזוקה ידועים ומתואמת לאוכלוסיית הרכבים בישראל. נתונים אלו הם אומדן בלבד.'
        : 'התפלגות גיל הרכבים עדיין נטענת, אז העוצמות כאן אינן משוקללות לפי מספר הרכבים בכל גיל. כדאי לרענן בעוד דקה.',
      note_en: ageDataReady
        ? 'Estimate based on known maintenance patterns correlated with Israeli vehicle population. These figures are estimates only.'
        : 'The vehicle age distribution is still warming, so these intensities are not yet scaled to the number of cars at each age.',
      cached_at: new Date().toISOString(),
    }

    // A payload computed WITHOUT the age histogram must not be cached for a day — it would
    // outlive the warm-up it is apologising for. Five minutes is long enough to absorb a
    // reload, short enough that the next visit gets the real thing.
    await setCache(CACHE_KEY, response, ageDataReady ? CACHE_TTL : 300)

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Vehicle Lifecycle] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch lifecycle data' },
      { status: 500 },
    )
  }
}
