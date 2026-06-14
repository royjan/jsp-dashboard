export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDemandAnalysis } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

interface SearchDemandItem {
  query: string
  normalized_query: string | null
  search_count: number
  zero_result_count: number
  has_results_count: number
  avg_response_ms: number
  unique_users: number
  last_searched: string
}

interface TrendingQuery {
  query: string
  recent_count: number
  previous_count: number
  growth_pct: number
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'overview'
    const days = parseInt(searchParams.get('days') || '30', 10)

    const cutoff = new Date(Date.now() - days * 86400000).toISOString()

    if (view === 'overview') {
      // Run all queries in parallel
      const [erpDemand, searchMetrics, topSearched, zeroResults, trending] = await Promise.all([
        getDemandAnalysis().catch(() => []),
        getSearchMetrics(cutoff),
        getTopSearchedItems(cutoff, 20),
        getZeroResultQueries(cutoff, 20),
        getTrendingQueries(days),
      ])

      return NextResponse.json({
        erp_demand: { items: erpDemand, count: erpDemand.length },
        search_metrics: searchMetrics,
        top_searched: topSearched,
        zero_results: zeroResults,
        trending: trending,
      })
    }

    if (view === 'search_metrics') {
      const metrics = await getSearchMetrics(cutoff)
      return NextResponse.json(metrics)
    }

    if (view === 'top_searched') {
      const limit = parseInt(searchParams.get('limit') || '50', 10)
      const items = await getTopSearchedItems(cutoff, limit)
      return NextResponse.json({ items, count: items.length })
    }

    if (view === 'zero_results') {
      const limit = parseInt(searchParams.get('limit') || '50', 10)
      const items = await getZeroResultQueries(cutoff, limit)
      return NextResponse.json({ items, count: items.length })
    }

    if (view === 'trending') {
      const items = await getTrendingQueries(days)
      return NextResponse.json({ items, count: items.length })
    }

    return NextResponse.json({ error: 'Invalid view' }, { status: 400 })
  } catch (error) {
    console.error('[Demand API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}

async function getSearchMetrics(cutoff: string) {
  const result = await query(`
    SELECT
      COUNT(*)::int AS total_searches,
      COUNT(*) FILTER (WHERE has_results = false)::int AS zero_result_count,
      ROUND(100.0 * COUNT(*) FILTER (WHERE has_results = false) / NULLIF(COUNT(*), 0), 1) AS zero_result_rate,
      ROUND(AVG(response_time_ms))::int AS avg_response_ms,
      COUNT(DISTINCT user_id)::int AS unique_users
    FROM search_analytics
    WHERE created_at >= $1
  `, [cutoff])
  return result.rows[0] || {
    total_searches: 0,
    zero_result_count: 0,
    zero_result_rate: 0,
    avg_response_ms: 0,
    unique_users: 0,
  }
}

async function getTopSearchedItems(cutoff: string, limit: number): Promise<SearchDemandItem[]> {
  const result = await query(`
    SELECT
      query,
      normalized_query,
      COUNT(*)::int AS search_count,
      COUNT(*) FILTER (WHERE has_results = false)::int AS zero_result_count,
      COUNT(*) FILTER (WHERE has_results = true)::int AS has_results_count,
      ROUND(AVG(response_time_ms))::int AS avg_response_ms,
      COUNT(DISTINCT user_id)::int AS unique_users,
      MAX(created_at)::text AS last_searched
    FROM search_analytics
    WHERE created_at >= $1
      AND intent IN ('parts_inquiry', 'item_lookup', 'price_inquiry', 'stock_inquiry')
    GROUP BY query, normalized_query
    ORDER BY search_count DESC
    LIMIT $2
  `, [cutoff, limit])
  return result.rows
}

async function getZeroResultQueries(cutoff: string, limit: number): Promise<SearchDemandItem[]> {
  const result = await query(`
    SELECT
      query,
      normalized_query,
      COUNT(*)::int AS search_count,
      COUNT(*)::int AS zero_result_count,
      0::int AS has_results_count,
      ROUND(AVG(response_time_ms))::int AS avg_response_ms,
      COUNT(DISTINCT user_id)::int AS unique_users,
      MAX(created_at)::text AS last_searched
    FROM search_analytics
    WHERE created_at >= $1
      AND has_results = false
      AND intent IN ('parts_inquiry', 'item_lookup', 'price_inquiry', 'stock_inquiry')
    GROUP BY query, normalized_query
    ORDER BY search_count DESC
    LIMIT $2
  `, [cutoff, limit])
  return result.rows
}

async function getTrendingQueries(days: number): Promise<TrendingQuery[]> {
  const recentCutoff = new Date(Date.now() - days * 86400000).toISOString()
  const previousCutoff = new Date(Date.now() - days * 2 * 86400000).toISOString()

  const result = await query(`
    WITH recent AS (
      SELECT COALESCE(normalized_query, query) AS q, COUNT(*)::int AS cnt
      FROM search_analytics
      WHERE created_at >= $1
        AND intent IN ('parts_inquiry', 'item_lookup', 'price_inquiry', 'stock_inquiry')
      GROUP BY q
      HAVING COUNT(*) >= 2
    ),
    previous AS (
      SELECT COALESCE(normalized_query, query) AS q, COUNT(*)::int AS cnt
      FROM search_analytics
      WHERE created_at >= $2 AND created_at < $1
        AND intent IN ('parts_inquiry', 'item_lookup', 'price_inquiry', 'stock_inquiry')
      GROUP BY q
    )
    SELECT
      r.q AS query,
      r.cnt AS recent_count,
      COALESCE(p.cnt, 0)::int AS previous_count,
      CASE
        WHEN COALESCE(p.cnt, 0) = 0 THEN 100
        ELSE ROUND(100.0 * (r.cnt - p.cnt) / p.cnt, 1)
      END AS growth_pct
    FROM recent r
    LEFT JOIN previous p ON r.q = p.q
    WHERE r.cnt > COALESCE(p.cnt, 0)
    ORDER BY growth_pct DESC, r.cnt DESC
    LIMIT 20
  `, [recentCutoff, previousCutoff])
  return result.rows
}
