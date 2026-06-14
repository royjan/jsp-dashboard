/**
 * Customer Health Score — computes a 0-100 score per customer from existing
 * revenue/invoice metrics, without any additional Finansit calls.
 *
 * Score factors (all derived from getCustomerAnalytics output):
 *   - Return rate (credits / gross invoices)
 *   - Recency (days since last purchase)
 *   - Trend (YoY revenue direction)
 *
 * No Finansit writes. Pure read + derive.
 */

export interface CustomerInput {
  code: string
  name: string
  gross_invoices: number
  total_credits: number
  total_revenue: number
  invoice_count: number
  last_purchase: string // YYYY-MM-DD
  trend: 'up' | 'down' | 'stable' | string
  this_year_revenue: number
  last_year_revenue: number
}

export interface HealthScore {
  code: string
  name: string
  score: number // 0-100
  band: 'green' | 'yellow' | 'red'
  factors: {
    returnRate: number // 0-1
    daysSinceLastPurchase: number | null
    trend: 'up' | 'down' | 'stable'
    yoyChangePct: number | null // this_year vs last_year, % change
  }
  penalties: {
    returnRate: number
    recency: number
    trend: number
  }
  total_revenue: number
  last_purchase: string
}

function daysSince(dateStr: string): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  const now = Date.now()
  return Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function scoreCustomer(c: CustomerInput): HealthScore {
  // ── Return rate (0–30 penalty) ────────────────────────────────────
  // Guard: if zero invoices, return rate is 0 (can't penalize no business)
  const returnRate =
    c.gross_invoices > 0 ? c.total_credits / c.gross_invoices : 0
  const returnPenalty = clamp(returnRate * 100, 0, 30)

  // ── Recency (0–40 penalty) ────────────────────────────────────────
  const days = daysSince(c.last_purchase)
  let recencyPenalty = 0
  if (days === null) {
    recencyPenalty = 30 // no purchase date known → treat as stale
  } else if (days <= 30) recencyPenalty = 0
  else if (days <= 60) recencyPenalty = 5
  else if (days <= 90) recencyPenalty = 15
  else if (days <= 180) recencyPenalty = 25
  else recencyPenalty = 40

  // ── Trend (±10) ───────────────────────────────────────────────────
  // Normalize trend to known values
  const trend: 'up' | 'down' | 'stable' =
    c.trend === 'up' || c.trend === 'down' || c.trend === 'stable'
      ? c.trend
      : 'stable'
  let trendAdjust = 0
  if (trend === 'up') trendAdjust = -(-10) // +10 (bonus = negative penalty)
  else if (trend === 'down') trendAdjust = 10
  else trendAdjust = 0

  // YoY change for display (not scored separately to avoid double-counting trend)
  const yoyChangePct =
    c.last_year_revenue > 0
      ? ((c.this_year_revenue - c.last_year_revenue) / c.last_year_revenue) * 100
      : c.this_year_revenue > 0
        ? 100
        : null

  const rawScore = 100 - returnPenalty - recencyPenalty - trendAdjust
  const score = Math.round(clamp(rawScore, 0, 100))

  const band: HealthScore['band'] =
    score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red'

  return {
    code: c.code,
    name: c.name,
    score,
    band,
    factors: { returnRate, daysSinceLastPurchase: days, trend, yoyChangePct },
    penalties: {
      returnRate: Math.round(returnPenalty),
      recency: recencyPenalty,
      trend: trendAdjust,
    },
    total_revenue: c.total_revenue,
    last_purchase: c.last_purchase,
  }
}

export interface HealthScoreSummary {
  scores: HealthScore[]
  distribution: { green: number; yellow: number; red: number }
  avgScore: number
  atRiskRevenue: number // revenue tied to red-band customers
}

export function scoreAllCustomers(
  customers: CustomerInput[],
): HealthScoreSummary {
  const scores = customers.map(scoreCustomer)
  const distribution = { green: 0, yellow: 0, red: 0 }
  let atRiskRevenue = 0
  let totalScore = 0
  for (const s of scores) {
    distribution[s.band]++
    totalScore += s.score
    if (s.band === 'red') atRiskRevenue += s.total_revenue
  }
  return {
    scores,
    distribution,
    avgScore: scores.length > 0 ? Math.round(totalScore / scores.length) : 0,
    atRiskRevenue,
  }
}
