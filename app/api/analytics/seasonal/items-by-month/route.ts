export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { getCanonicalizer, foldByChain } from '@/lib/services/analytics-service'

const TOP_N = 8

/**
 * Top items per calendar month — answers "which SKUs are strong in which period".
 * Sums dashboard.monthly_sales across all years in the range, grouped by month,
 * and returns the top N items by revenue for each of the 12 months.
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('date_from') || undefined
    const dateTo = searchParams.get('date_to') || undefined

    const cacheKey = `analytics:seasonal-by-month:v2:${dateFrom || 'all'}:${dateTo || 'all'}`
    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    const conds: string[] = []
    const params: any[] = []
    let idx = 1
    if (dateFrom) {
      const fy = parseInt(dateFrom.substring(0, 4), 10)
      const fm = parseInt(dateFrom.substring(5, 7), 10)
      conds.push(`(year > $${idx} OR (year = $${idx} AND month >= $${idx + 1}))`)
      params.push(fy, fm); idx += 2
    }
    if (dateTo) {
      const ty = parseInt(dateTo.substring(0, 4), 10)
      const tm = parseInt(dateTo.substring(5, 7), 10)
      conds.push(`(year < $${idx} OR (year = $${idx} AND month <= $${idx + 1}))`)
      params.push(ty, tm); idx += 2
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const res = await query(
      `SELECT month, item_code, MAX(item_name) AS item_name,
              SUM(revenue) AS revenue, SUM(quantity) AS qty
         FROM dashboard.monthly_sales
         ${where}
         GROUP BY month, item_code
         HAVING SUM(revenue) > 0`,
      params,
    )

    const byMonth = new Map<number, any[]>()
    for (const r of res.rows as any[]) {
      const m = Number(r.month)
      if (!m) continue
      const arr = byMonth.get(m) || []
      arr.push({
        item_code: r.item_code,
        item_name: r.item_name || r.item_code,
        revenue: Math.round(Number(r.revenue) || 0),
        qty: Math.round(Number(r.qty) || 0),
      })
      byMonth.set(m, arr)
    }

    // Fold each month's rows onto their canonical codes before taking the top N.
    // monthly_sales is keyed by whatever code was current when the invoice was
    // written, so one part superseded mid-history shows up as two lesser items
    // and can miss the cut that either half's merged total would have made.
    const canon = await getCanonicalizer()
    const months = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
      month: m,
      items: foldByChain(byMonth.get(m) || [], canon, {
        codeField: 'item_code',
        sum: ['revenue', 'qty'],
        longest: ['item_name'],
      })
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, TOP_N),
    }))

    const payload = { months }
    await setCache(cacheKey, payload, 48 * 60 * 60) // seasonal data changes slowly
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[seasonal-by-month] Error:', error)
    return NextResponse.json({ months: [], error: error instanceof Error ? error.message : 'Failed' })
  }
}
