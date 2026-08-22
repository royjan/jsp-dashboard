export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems, itemCategory, getCanonicalizer } from '@/lib/services/analytics-service'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

const CACHE_KEY = 'vehicle-population:lifecycle:v1'
const CACHE_TTL = 86400 // 24h

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
    const catByCode = new Map<string, string>()
    for (const it of await getItems()) {
      const code = String(it.code ?? '').toUpperCase()
      if (code) catByCode.set(code, itemCategory(it))
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

    // Vehicle age distribution for normalization
    const ageDistResult = await query(`
      SELECT
        ($1 - EXTRACT(YEAR FROM "registrationDate")::int) as age,
        SUM(COALESCE(quantity, 1)) as count
      FROM ics."Vehicles"
      WHERE EXTRACT(YEAR FROM "registrationDate") >= $2
        AND EXTRACT(YEAR FROM "registrationDate") <= $1
      GROUP BY age
      ORDER BY age
    `, [currentYear, currentYear - 15])

    const ageDistMap = new Map<number, number>()
    for (const row of ageDistResult.rows) {
      ageDistMap.set(Number(row.age), Number(row.count))
    }

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
      note_he: 'הערכה מבוססת על דפוסי תחזוקה ידועים ומתואמת לאוכלוסיית הרכבים בישראל. נתונים אלו הם אומדן בלבד.',
      note_en: 'Estimate based on known maintenance patterns correlated with Israeli vehicle population. These figures are estimates only.',
      cached_at: new Date().toISOString(),
    }

    await setCache(CACHE_KEY, response, CACHE_TTL)

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Vehicle Lifecycle] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch lifecycle data' },
      { status: 500 },
    )
  }
}
