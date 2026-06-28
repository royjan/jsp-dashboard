/**
 * Parts-bot search analytics for the integrated chat admin.
 * Faithful port of jsp-chat-js getPartsBotMetrics onto raw `query()` against the
 * shared `search_analytics` (+ `flow_decisions_v2`) tables. Read-only.
 */

import { query } from '@/lib/db'

const SRC = 'telegram_bot'

export interface PartsBotMetrics {
  total: number
  notFound: number
  notFoundRate: number
  oos: number
  oosRate: number
  inStock: number
  inStockRate: number
  pg: number
  pgCoverage: number
  uniqueUsers: number
  p50: number
  p95: number
  topNotFound: Array<{ query: string; count: number }>
  topOOS: Array<{ query: string; count: number }>
  byFlowSource: Array<{ source: string; count: number }>
  byLambda: Array<{ lambda: string; count: number; notFound: number; notFoundRate: number; p95: number }>
  schemaFlips: Array<{ query: string; schemas: string[]; n: number }>
  daily: Array<{ date: string; total: number; notFound: number; oos: number }>
  byIntent: Array<{ intent: string; count: number; llmShare: number }>
  prev: { total: number; notFoundRate: number; oosRate: number; inStockRate: number; pgCoverage: number; p95: number }
  learnedPinsTotal: number
  learnedPinsAddedInRange: number
  learnedPinsDaily: Array<{ date: string; added: number }>
}

const EMPTY_PREV = { total: 0, notFoundRate: 0, oosRate: 0, inStockRate: 0, pgCoverage: 0, p95: 0 }

interface FilterOpts {
  portal?: string
  gate?: string
}

/**
 * Build the parametrized bot filter. Params always start at $1 (preceding fixed
 * conditions in each query carry no params).
 */
function botFilter(
  startDate?: Date,
  endDate?: Date,
  opts?: FilterOpts,
  { excludeIntentOnly = true, endExclusive = false }: { excludeIntentOnly?: boolean; endExclusive?: boolean } = {},
): { clause: string; params: unknown[] } {
  const conds: string[] = [`source = '${SRC}'`]
  const params: unknown[] = []
  if (excludeIntentOnly) conds.push(`COALESCE(metadata->>'intent_only','') <> 'true'`)
  if (startDate) {
    params.push(startDate.toISOString())
    conds.push(`created_at >= $${params.length}`)
  }
  if (endDate) {
    params.push(endDate.toISOString())
    conds.push(`created_at ${endExclusive ? '<' : '<='} $${params.length}`)
  }
  if (opts?.portal) {
    params.push(opts.portal)
    conds.push(`metadata->>'lambda_type' = $${params.length}`)
  }
  if (opts?.gate) {
    params.push(opts.gate)
    conds.push(`metadata->>'gate' = $${params.length}`)
  }
  return { clause: conds.join(' AND '), params }
}

const n = (v: unknown) => Number(v ?? 0)

export async function getPartsBotMetrics(
  startDate?: Date,
  endDate?: Date,
  opts?: FilterOpts,
): Promise<PartsBotMetrics> {
  try {
    const f = botFilter(startDate, endDate, opts)

    const totals = await query(
      `SELECT COUNT(*) total,
              COUNT(*) FILTER (WHERE has_results=false) notfound,
              COUNT(*) FILTER (WHERE has_results=true AND metadata->>'oos'='true') oos,
              COUNT(*) FILTER (WHERE has_results=true AND COALESCE(metadata->>'oos','') <> 'true') instock,
              COUNT(*) FILTER (WHERE metadata->>'flow_decision_source'='pg') pg
       FROM search_analytics WHERE ${f.clause}`,
      f.params,
    )
    const t = totals.rows[0] || {}
    const total = n(t.total), notFound = n(t.notfound), oos = n(t.oos), inStock = n(t.instock), pg = n(t.pg)

    const lat = await query(
      `SELECT PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)::int AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int AS p95,
              COUNT(DISTINCT user_id) AS users
       FROM search_analytics WHERE response_time_ms IS NOT NULL AND ${f.clause}`,
      f.params,
    )
    const l = lat.rows[0] || {}
    const p50 = n(l.p50), p95 = n(l.p95), uniqueUsers = n(l.users)

    const topNotFound = await query(
      `SELECT query, COUNT(*) count FROM search_analytics WHERE has_results=false AND ${f.clause}
       GROUP BY query ORDER BY count DESC LIMIT 15`,
      f.params,
    )
    const topOOS = await query(
      `SELECT query, COUNT(*) count FROM search_analytics
       WHERE has_results=true AND metadata->>'oos'='true' AND ${f.clause}
       GROUP BY query ORDER BY count DESC LIMIT 15`,
      f.params,
    )
    const byFlowSource = await query(
      `SELECT COALESCE(metadata->>'flow_decision_source','unknown') source, COUNT(*) count
       FROM search_analytics WHERE ${f.clause} GROUP BY 1 ORDER BY count DESC`,
      f.params,
    )
    const byLambda = await query(
      `SELECT COALESCE(metadata->>'lambda_type','unknown') lambda,
              COUNT(*) count,
              COUNT(*) FILTER (WHERE has_results=false) notfound,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int p95
       FROM search_analytics WHERE ${f.clause} GROUP BY 1 ORDER BY count DESC`,
      f.params,
    )
    const flips = await query(
      `SELECT normalized_query query, array_agg(DISTINCT metadata->>'schema') schemas, COUNT(DISTINCT metadata->>'schema') nn
       FROM search_analytics WHERE has_results=true AND metadata->>'schema' IS NOT NULL AND ${f.clause}
       GROUP BY normalized_query HAVING COUNT(DISTINCT metadata->>'schema') > 1
       ORDER BY nn DESC LIMIT 15`,
      f.params,
    )
    const daily = await query(
      `SELECT DATE(created_at) date, COUNT(*) total,
              COUNT(*) FILTER (WHERE has_results=false) notfound,
              COUNT(*) FILTER (WHERE has_results=true AND metadata->>'oos'='true') oos
       FROM search_analytics WHERE ${f.clause} GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 92`,
      f.params,
    )

    // Intent distribution — NOT filtered by intent_only exclusion.
    const fi = botFilter(startDate, endDate, opts, { excludeIntentOnly: false })
    const byIntentRows = await query(
      `SELECT COALESCE(NULLIF(intent,''),'unknown') intent, COUNT(*) count,
              COUNT(*) FILTER (WHERE metadata->>'llm_source' = 'llm') llm
       FROM search_analytics WHERE ${fi.clause} GROUP BY 1 ORDER BY count DESC`,
      fi.params,
    )

    // Previous equal-length window
    const span = startDate && endDate ? endDate.getTime() - startDate.getTime() : 0
    const prevEnd = startDate ?? undefined
    const prevStart = startDate && span ? new Date(startDate.getTime() - span) : undefined
    let prev = { ...EMPTY_PREV }
    if (prevStart && prevEnd) {
      // Match the current window's population (intent_only excluded) so the
      // current-vs-previous deltas compare like with like.
      const fp = botFilter(prevStart, prevEnd, opts, { excludeIntentOnly: true, endExclusive: true })
      const pRes = await query(
        `SELECT COUNT(*) total,
                COUNT(*) FILTER (WHERE has_results=false) notfound,
                COUNT(*) FILTER (WHERE has_results=true AND metadata->>'oos'='true') oos,
                COUNT(*) FILTER (WHERE has_results=true AND COALESCE(metadata->>'oos','') <> 'true') instock,
                COUNT(*) FILTER (WHERE metadata->>'flow_decision_source'='pg') pg,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int p95
         FROM search_analytics WHERE ${fp.clause}`,
        fp.params,
      )
      const pt = pRes.rows[0] || {}
      const pTotal = n(pt.total)
      const ppct = (x: number) => (pTotal > 0 ? Math.round((x / pTotal) * 1000) / 10 : 0)
      prev = {
        total: pTotal,
        notFoundRate: ppct(n(pt.notfound)),
        oosRate: ppct(n(pt.oos)),
        inStockRate: ppct(n(pt.instock)),
        pgCoverage: ppct(n(pt.pg)),
        p95: n(pt.p95),
      }
    }

    // Learning-loop counts (isolated so a failure never blanks the dashboard)
    let learnedPinsTotal = 0, learnedPinsAddedInRange = 0
    let learnedPinsDaily: Array<{ date: string; added: number }> = []
    try {
      const lpParams: unknown[] = []
      let inRangeExpr = 'false'
      if (startDate && endDate) {
        lpParams.push(startDate.toISOString(), endDate.toISOString())
        inRangeExpr = `created_at >= $1 AND created_at <= $2`
      }
      const lp = await query(
        `SELECT COUNT(*) total, COUNT(*) FILTER (WHERE ${inRangeExpr}) in_range
         FROM flow_decisions_v2
         WHERE source IN ('schema_ref_correction','agent_correction_seed','chat_correction')`,
        lpParams,
      )
      learnedPinsTotal = n(lp.rows[0]?.total)
      learnedPinsAddedInRange = n(lp.rows[0]?.in_range)

      const lpdParams: unknown[] = []
      const lpdConds: string[] = [`source IN ('schema_ref_correction','agent_correction_seed','chat_correction')`]
      if (startDate) {
        lpdParams.push(startDate.toISOString())
        lpdConds.push(`created_at >= $${lpdParams.length}`)
      }
      if (endDate) {
        lpdParams.push(endDate.toISOString())
        lpdConds.push(`created_at <= $${lpdParams.length}`)
      }
      const lpDaily = await query(
        `SELECT DATE(created_at) date, COUNT(*) added FROM flow_decisions_v2
         WHERE ${lpdConds.join(' AND ')} GROUP BY 1 ORDER BY date ASC`,
        lpdParams,
      )
      learnedPinsDaily = lpDaily.rows.map((r: any) => ({
        date: new Date(r.date).toISOString().split('T')[0],
        added: n(r.added),
      }))
    } catch {
      // non-fatal
    }

    const pct = (x: number) => (total > 0 ? Math.round((x / total) * 1000) / 10 : 0)
    return {
      total,
      notFound,
      notFoundRate: pct(notFound),
      oos,
      oosRate: pct(oos),
      inStock,
      inStockRate: pct(inStock),
      pg,
      pgCoverage: pct(pg),
      uniqueUsers,
      p50,
      p95,
      topNotFound: topNotFound.rows.map((r: any) => ({ query: r.query, count: n(r.count) })),
      topOOS: topOOS.rows.map((r: any) => ({ query: r.query, count: n(r.count) })),
      byFlowSource: byFlowSource.rows.map((r: any) => ({ source: r.source, count: n(r.count) })),
      byLambda: byLambda.rows.map((r: any) => {
        const count = n(r.count), nf = n(r.notfound)
        return {
          lambda: r.lambda,
          count,
          notFound: nf,
          notFoundRate: count > 0 ? Math.round((nf / count) * 1000) / 10 : 0,
          p95: n(r.p95),
        }
      }),
      schemaFlips: flips.rows.map((r: any) => ({
        query: r.query,
        schemas: (r.schemas || []).filter(Boolean),
        n: n(r.nn),
      })),
      daily: daily.rows
        .map((r: any) => ({
          date: new Date(r.date).toISOString().split('T')[0],
          total: n(r.total),
          notFound: n(r.notfound),
          oos: n(r.oos),
        }))
        .reverse(),
      byIntent: byIntentRows.rows.map((r: any) => {
        const count = n(r.count)
        return { intent: r.intent, count, llmShare: count > 0 ? Math.round((n(r.llm) / count) * 1000) / 10 : 0 }
      }),
      prev,
      learnedPinsTotal,
      learnedPinsAddedInRange,
      learnedPinsDaily,
    }
  } catch (error) {
    console.error('[SearchAnalytics] Error getting parts-bot metrics:', error)
    return {
      total: 0, notFound: 0, notFoundRate: 0, oos: 0, oosRate: 0, inStock: 0, inStockRate: 0,
      pg: 0, pgCoverage: 0, uniqueUsers: 0, p50: 0, p95: 0,
      topNotFound: [], topOOS: [], byFlowSource: [], byLambda: [], schemaFlips: [], daily: [], byIntent: [],
      prev: { ...EMPTY_PREV }, learnedPinsTotal: 0, learnedPinsAddedInRange: 0, learnedPinsDaily: [],
    }
  }
}
