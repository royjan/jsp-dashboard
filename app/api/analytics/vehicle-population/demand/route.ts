export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

const CACHE_TTL = 86400 // 24h

/**
 * Demand prediction: cross-reference vehicle population with parts sales.
 *
 * Accepts: make, model, year_range (0-3, 3-7, 7-12, 12+)
 * Returns: estimated demand by parts category based on vehicle count and historical sales.
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()

    const { searchParams } = new URL(request.url)
    const make = searchParams.get('make') || ''
    const model = searchParams.get('model') || ''
    const yearRange = searchParams.get('year_range') || ''

    const cacheKey = `vehicle-population:demand:${make}:${model}:${yearRange}:v1`

    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    const currentYear = new Date().getFullYear()

    // Build vehicle count query based on filters
    let vehicleWhere = 'WHERE 1=1'
    const vehicleParams: any[] = []
    let paramIdx = 0

    if (make) {
      paramIdx++
      vehicleWhere += ` AND manufacturer = $${paramIdx}`
      vehicleParams.push(make)
    }
    if (model) {
      paramIdx++
      vehicleWhere += ` AND model = $${paramIdx}`
      vehicleParams.push(model)
    }
    if (yearRange) {
      const [minStr, maxStr] = yearRange.split('-')
      const minAge = parseInt(minStr) || 0
      const maxAge = maxStr === '+' || !maxStr ? 100 : parseInt(maxStr) || 100
      const fromYear = currentYear - maxAge
      const toYear = currentYear - minAge
      paramIdx++
      vehicleWhere += ` AND EXTRACT(YEAR FROM "registrationDate") > $${paramIdx}`
      vehicleParams.push(fromYear)
      paramIdx++
      vehicleWhere += ` AND EXTRACT(YEAR FROM "registrationDate") <= $${paramIdx}`
      vehicleParams.push(toYear)
    }

    // Get vehicle count for the filter
    const vehicleCountResult = await query(`
      SELECT COALESCE(SUM(COALESCE(quantity, 1)), 0) as count
      FROM ics."Vehicles"
      ${vehicleWhere}
    `, vehicleParams)
    const vehicleCount = Number(vehicleCountResult.rows[0]?.count || 0)

    // Get top parts categories from monthly sales (dashboard schema)
    // These represent what parts sell most, grouped by category
    const categorySalesResult = await query(`
      SELECT
        COALESCE(category, 'ללא קטגוריה') as category,
        SUM(quantity::numeric) as total_qty,
        SUM(revenue::numeric) as total_revenue,
        COUNT(DISTINCT ms.item_code) as unique_items,
        AVG(quantity::numeric) as avg_monthly_qty
      FROM dashboard.monthly_sales ms
      LEFT JOIN dashboard.item_snapshots snap
        ON ms.item_code = snap.item_code
        AND snap.snapshot_date = (SELECT MAX(snapshot_date) FROM dashboard.item_snapshots)
      WHERE ms.year >= $1
      GROUP BY COALESCE(category, 'ללא קטגוריה')
      HAVING SUM(quantity::numeric) > 10
      ORDER BY total_qty DESC
      LIMIT 20
    `, [currentYear - 2])

    // Lifecycle-based demand multipliers
    // Vehicles 0-3y: mostly filters, oils
    // Vehicles 3-7y: brakes, timing belts start
    // Vehicles 7-12y: suspension, timing, clutch peak
    // Vehicles 12+y: everything needs replacing
    const ageMultipliers: Record<string, Record<string, number>> = {
      '0-3': { 'filters': 1.0, 'oils': 1.0, 'brakes': 0.3, 'timing': 0.1, 'suspension': 0.1, 'default': 0.2 },
      '3-7': { 'filters': 1.2, 'oils': 1.1, 'brakes': 1.0, 'timing': 0.8, 'suspension': 0.5, 'default': 0.6 },
      '7-12': { 'filters': 1.3, 'oils': 1.2, 'brakes': 1.5, 'timing': 1.5, 'suspension': 1.3, 'default': 1.2 },
      '12+': { 'filters': 1.0, 'oils': 1.0, 'brakes': 1.8, 'timing': 1.0, 'suspension': 1.8, 'default': 1.5 },
    }

    // Get active age range or default
    const activeRange = yearRange?.replace('+', '') || '0-100'
    const bracketKey = Object.keys(ageMultipliers).find(k => {
      if (yearRange === '12+' || yearRange === '12-+') return k === '12+'
      return yearRange === k || yearRange?.startsWith(k.split('-')[0])
    }) || '7-12'

    const multipliers = ageMultipliers[bracketKey] || ageMultipliers['7-12']

    // Build demand predictions per category
    const predictions = categorySalesResult.rows.map((row: any) => {
      const category = row.category as string
      const categoryLower = category.toLowerCase()

      // Find matching multiplier
      let multiplier = multipliers['default']
      for (const [key, val] of Object.entries(multipliers)) {
        if (key !== 'default' && categoryLower.includes(key)) {
          multiplier = val
          break
        }
      }

      // Base demand rate = avg monthly sales / total vehicles in market * filtered vehicle count
      const avgMonthlyQty = Number(row.avg_monthly_qty) || 0
      const estimatedDemand = Math.round(avgMonthlyQty * multiplier * (vehicleCount / 100000))

      return {
        category,
        total_sales_qty: Number(row.total_qty),
        total_revenue: Number(row.total_revenue),
        unique_items: Number(row.unique_items),
        avg_monthly_qty: avgMonthlyQty,
        estimated_monthly_demand: estimatedDemand,
        multiplier,
        confidence: yearRange && make ? 'medium' : 'low',
      }
    })

    const response = {
      vehicle_count: vehicleCount,
      filters: { make, model, year_range: yearRange },
      predictions: predictions.sort((a, b) => b.estimated_monthly_demand - a.estimated_monthly_demand),
      note_he: 'הערכה מבוססת על מתאם בין אוכלוסיית הרכבים להיסטוריית מכירות. נתונים אלו הם אומדן בלבד.',
      note_en: 'Estimate based on correlation between vehicle population and sales history. These figures are estimates only.',
      cached_at: new Date().toISOString(),
    }

    await setCache(cacheKey, response, CACHE_TTL)

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Vehicle Demand] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch demand prediction' },
      { status: 500 },
    )
  }
}
