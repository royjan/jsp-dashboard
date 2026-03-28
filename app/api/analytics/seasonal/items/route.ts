export const maxDuration = 60

import { NextResponse } from 'next/server'
import { readQuery } from '@/lib/sqlite'
import { query as pgQuery } from '@/lib/db'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { getCached, setCache } from '@/lib/redis-client'
import { getItems } from '@/lib/services/analytics-service'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

export interface SeasonalItem {
  item_code: string
  item_name: string
  winter_revenue: number
  summer_revenue: number
  total_revenue: number
  winter_qty: number
  summer_qty: number
  total_qty: number
  winter_share: number  // normalized by months-in-range
  summer_share: number  // normalized by months-in-range
  seasonality_score: number
  year_count: number
  is_relative?: boolean
}

const WINTER_MONTHS = new Set([11, 12, 1, 2, 3, 4])
const SUMMER_MONTHS = new Set([5, 6, 7, 8, 9, 10])

/** Count how many winter/summer calendar months fall within [dateFrom, dateTo] */
function countSeasonMonths(dateFrom?: string, dateTo?: string) {
  const now = new Date()
  const fromStr = dateFrom || `${now.getFullYear() - 2}-01-01`
  const toStr = dateTo || now.toISOString().split('T')[0]
  let cy = parseInt(fromStr.substring(0, 4), 10)
  let cm = parseInt(fromStr.substring(5, 7), 10)
  const toY = parseInt(toStr.substring(0, 4), 10)
  const toM = parseInt(toStr.substring(5, 7), 10)
  let winterCount = 0, summerCount = 0
  while (cy < toY || (cy === toY && cm <= toM)) {
    if (WINTER_MONTHS.has(cm)) winterCount++
    else summerCount++
    if (++cm > 12) { cm = 1; cy++ }
  }
  return { winterCount: Math.max(winterCount, 1), summerCount: Math.max(summerCount, 1) }
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('date_from') || undefined
    const dateTo = searchParams.get('date_to') || undefined
    const aiEnabled = searchParams.get('ai') === 'true'

    const cacheKey = `analytics:seasonal-items:v7:${dateFrom || 'all'}:${dateTo || 'all'}:${aiEnabled}`
    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Count season months in range for normalization
    const { winterCount, summerCount } = countSeasonMonths(dateFrom, dateTo)

    // Build WHERE clause for SQLite (uses ? placeholders)
    const conditions: string[] = []
    const params: any[] = []

    if (dateFrom) {
      const fromYear = parseInt(dateFrom.substring(0, 4), 10)
      const fromMonth = parseInt(dateFrom.substring(5, 7), 10)
      conditions.push(`(year > ? OR (year = ? AND month >= ?))`)
      params.push(fromYear, fromYear, fromMonth)
    }
    if (dateTo) {
      const toYear = parseInt(dateTo.substring(0, 4), 10)
      const toMonth = parseInt(dateTo.substring(5, 7), 10)
      conditions.push(`(year < ? OR (year = ? AND month <= ?))`)
      params.push(toYear, toYear, toMonth)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Check if SQLite table has any data at all
    const tableCheck = readQuery('SELECT COUNT(*) AS cnt FROM monthly_sales LIMIT 1', [])
    const hasTableData = Number(tableCheck.rows[0]?.cnt || 0) > 0

    // Fetch SQLite rows and items (for chain resolution) in parallel
    let sqliteResult = hasTableData
      ? readQuery(
          `SELECT
             item_code,
             MAX(item_name) AS item_name,
             SUM(CASE WHEN month IN (11,12,1,2,3,4) THEN revenue ELSE 0 END) AS winter_revenue,
             SUM(CASE WHEN month IN (5,6,7,8,9,10) THEN revenue ELSE 0 END) AS summer_revenue,
             SUM(revenue) AS total_revenue,
             SUM(CASE WHEN month IN (11,12,1,2,3,4) THEN quantity ELSE 0 END) AS winter_qty,
             SUM(CASE WHEN month IN (5,6,7,8,9,10) THEN quantity ELSE 0 END) AS summer_qty,
             SUM(quantity) AS total_qty,
             COUNT(DISTINCT year) AS year_count
           FROM monthly_sales
           ${whereClause}
           GROUP BY item_code
           HAVING SUM(revenue) > 100
           ORDER BY total_revenue DESC
           LIMIT 1000`,
          params
        )
      : { rows: [] as any[] }

    const allItems = await getItems().catch(() => [])

    // If SQLite is empty, fall back to app PostgreSQL dashboard.monthly_sales
    if (sqliteResult.rows.length === 0) {
      try {
        const pgParams: any[] = []
        const pgConds: string[] = []
        let idx = 1
        if (dateFrom) {
          const fy = parseInt(dateFrom.substring(0, 4), 10)
          const fm = parseInt(dateFrom.substring(5, 7), 10)
          pgConds.push(`(year > $${idx} OR (year = $${idx} AND month >= $${idx + 1}))`)
          pgParams.push(fy, fm); idx += 2
        }
        if (dateTo) {
          const ty = parseInt(dateTo.substring(0, 4), 10)
          const tm = parseInt(dateTo.substring(5, 7), 10)
          pgConds.push(`(year < $${idx} OR (year = $${idx} AND month <= $${idx + 1}))`)
          pgParams.push(ty, tm); idx += 2
        }
        const pgWhere = pgConds.length > 0 ? `WHERE ${pgConds.join(' AND ')}` : ''
        const pgResult = await pgQuery(`
          SELECT item_code, MAX(item_name) AS item_name,
            SUM(CASE WHEN month IN (11,12,1,2,3,4) THEN revenue ELSE 0 END) AS winter_revenue,
            SUM(CASE WHEN month IN (5,6,7,8,9,10) THEN revenue ELSE 0 END) AS summer_revenue,
            SUM(revenue) AS total_revenue,
            SUM(CASE WHEN month IN (11,12,1,2,3,4) THEN quantity ELSE 0 END) AS winter_qty,
            SUM(CASE WHEN month IN (5,6,7,8,9,10) THEN quantity ELSE 0 END) AS summer_qty,
            SUM(quantity) AS total_qty,
            COUNT(DISTINCT year) AS year_count
          FROM dashboard.monthly_sales
          ${pgWhere}
          GROUP BY item_code
          HAVING SUM(revenue) > 100
          ORDER BY total_revenue DESC
          LIMIT 1000
        `, pgParams)
        if (pgResult.rows.length > 0) {
          sqliteResult = pgResult
          console.log(`[Seasonal Items] Using app PostgreSQL fallback: ${pgResult.rows.length} rows`)
        }
      } catch (pgErr) {
        console.warn('[Seasonal Items] PostgreSQL fallback failed:', pgErr)
      }
    }

    // If still no data, return no_sync_data
    if (sqliteResult.rows.length === 0) {
      const emptyResponse = {
        winter_items: [],
        summer_items: [],
        ai_insights: null,
        total_analyzed: 0,
        empty_reason: 'no_sync_data' as const,
      }
      await setCache(cacheKey, emptyResponse, 3600)
      return NextResponse.json(emptyResponse)
    }

    const result = sqliteResult

    // Build alias → canonical code map for chain resolution
    const aliasToCanonical = new Map<string, string>()
    const canonicalName = new Map<string, string>()
    for (const item of allItems) {
      aliasToCanonical.set(item.code, item.code)
      canonicalName.set(item.code, item.name)
      for (const alias of (item.alias_codes || [])) {
        aliasToCanonical.set(alias, item.code)
      }
    }

    // Aggregate rows by canonical code
    type Agg = { item_name: string; winter_revenue: number; summer_revenue: number; total_revenue: number; winter_qty: number; summer_qty: number; total_qty: number; year_count: number }
    const aggMap = new Map<string, Agg>()
    for (const r of result.rows) {
      const rawCode: string = r.item_code
      const canonical = aliasToCanonical.get(rawCode) || rawCode
      const name = canonicalName.get(canonical) || r.item_name || canonical
      const existing = aggMap.get(canonical)
      if (existing) {
        existing.winter_revenue += parseFloat(r.winter_revenue) || 0
        existing.summer_revenue += parseFloat(r.summer_revenue) || 0
        existing.total_revenue += parseFloat(r.total_revenue) || 0
        existing.winter_qty += parseFloat(r.winter_qty) || 0
        existing.summer_qty += parseFloat(r.summer_qty) || 0
        existing.total_qty += parseFloat(r.total_qty) || 0
        existing.year_count = Math.max(existing.year_count, Number(r.year_count))
      } else {
        aggMap.set(canonical, {
          item_name: name,
          winter_revenue: parseFloat(r.winter_revenue) || 0,
          summer_revenue: parseFloat(r.summer_revenue) || 0,
          total_revenue: parseFloat(r.total_revenue) || 0,
          winter_qty: parseFloat(r.winter_qty) || 0,
          summer_qty: parseFloat(r.summer_qty) || 0,
          total_qty: parseFloat(r.total_qty) || 0,
          year_count: Number(r.year_count),
        })
      }
    }

    // Normalize shares by months-in-range so a uniform item always gets 0.5/0.5
    const items: SeasonalItem[] = Array.from(aggMap.entries()).map(([code, agg]) => {
      const winterAvg = agg.winter_revenue / winterCount
      const summerAvg = agg.summer_revenue / summerCount
      const avgTotal = winterAvg + summerAvg
      const winterShare = avgTotal > 0 ? winterAvg / avgTotal : 0.5
      const summerShare = avgTotal > 0 ? summerAvg / avgTotal : 0.5
      return {
        item_code: code,
        item_name: agg.item_name,
        winter_revenue: agg.winter_revenue,
        summer_revenue: agg.summer_revenue,
        total_revenue: agg.total_revenue,
        winter_qty: agg.winter_qty,
        summer_qty: agg.summer_qty,
        total_qty: agg.total_qty,
        winter_share: winterShare,
        summer_share: summerShare,
        seasonality_score: Math.abs(winterShare - 0.5) * 2,
        year_count: agg.year_count,
      }
    })

    if (items.length === 0) {
      const emptyResponse = {
        winter_items: [],
        summer_items: [],
        ai_insights: null,
        total_analyzed: 0,
        empty_reason: 'no_data_in_range' as const,
      }
      await setCache(cacheKey, emptyResponse, 3600)
      return NextResponse.json(emptyResponse)
    }

    // Detect if monthly_sales has zero summer month records for ALL items
    // (sync was only run during winter months → all summer_revenue = 0)
    const totalSummerRevenue = items.reduce((s, i) => s + i.summer_revenue, 0)
    const noSummerData = totalSummerRevenue === 0 && items.length > 0

    let finalWinter: SeasonalItem[]
    let finalSummer: SeasonalItem[]
    let isRelative = false

    if (noSummerData) {
      // Only winter data available — show top items by revenue as winter leaders
      finalWinter = [...items]
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 25)
      finalSummer = []
    } else {
      const winterItems = items
        .filter(i => i.winter_share > 0.52 && i.total_revenue > 200)
        .sort((a, b) => b.winter_share - a.winter_share)
        .slice(0, 25)

      const summerItems = items
        .filter(i => i.summer_share > 0.52 && i.total_revenue > 200)
        .sort((a, b) => b.summer_share - a.summer_share)
        .slice(0, 25)

      // Relative-leader fallback: if nothing passes threshold, show top items sorted by seasonal tendency
      isRelative = winterItems.length === 0 && summerItems.length === 0
      finalWinter = winterItems.length > 0
        ? winterItems
        : [...items].sort((a, b) => b.winter_share - a.winter_share).slice(0, 10)
      finalSummer = summerItems.length > 0
        ? summerItems
        : [...items].sort((a, b) => b.summer_share - a.summer_share).slice(0, 10)
    }

    let aiInsights: string | null = null
    if (aiEnabled) {
      const geminiKey = getSecret('GEMINI_API_KEY')
      if (geminiKey) {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = geminiKey
        const topWinter = finalWinter.slice(0, 12)
        const topSummer = finalSummer.slice(0, 12)
        const prompt = `You are an inventory analyst for an Israeli auto parts store. Analyze the following seasonal sales data.

Israeli seasons: Winter = Nov–Apr | Summer = May–Oct

Top WINTER items (higher winter revenue share):
${topWinter.map(i => `- ${i.item_name}: ${Math.round(i.winter_share * 100)}% winter, ₪${Math.round(i.total_revenue).toLocaleString()} total`).join('\n')}

Top SUMMER items (higher summer revenue share):
${topSummer.map(i => `- ${i.item_name}: ${Math.round(i.summer_share * 100)}% summer, ₪${Math.round(i.total_revenue).toLocaleString()} total`).join('\n')}

Write a practical analysis in Hebrew (4–6 bullet points) covering:
1. Which product categories dominate each season and why (from an auto parts perspective — weather, driving patterns)
2. Stock timing advice: when to increase/reduce inventory for seasonal items
3. Surprising patterns or missed opportunities
4. One concrete action to improve profitability

Keep it concise and actionable for a store owner. Use • for bullet points.`

        try {
          const { text } = await generateText({
            model: google('gemini-2.0-flash'),
            prompt,
          })
          aiInsights = text
        } catch (e) {
          console.warn('[Seasonal Items] AI generation failed:', e)
        }
      }
    }

    const response = {
      winter_items: finalWinter,
      summer_items: finalSummer,
      ai_insights: aiInsights,
      total_analyzed: items.length,
      is_relative: isRelative,
      no_summer_data: noSummerData,
    }

    await setCache(cacheKey, response, aiEnabled ? 12 * 3600 : 6 * 3600)
    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
