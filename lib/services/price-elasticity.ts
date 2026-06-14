/**
 * Price elasticity analysis — for each of the top N items by revenue,
 * compute the relationship between historical unit price and monthly demand.
 *
 * Unit price per month is derived from monthly_sales: price = revenue / quantity.
 * Prices per item are binned into 3 tiers (low/mid/high relative to that item's range).
 * For each tier we report avg monthly quantity sold.
 *
 * Items where demand is stable across tiers = candidates for price increases.
 * Items where demand drops sharply in higher tiers = price-sensitive, handle with care.
 *
 * Read-only — queries dashboard.monthly_sales only. No Finansit calls.
 */
import { query } from '@/lib/db'

export interface PricePoint {
  year: number
  month: number
  qty: number
  revenue: number
  unit_price: number
}

export interface ElasticityTier {
  label: 'low' | 'mid' | 'high'
  price_range: [number, number]
  avg_qty: number
  months: number
}

export interface ElasticityRow {
  item_code: string
  item_name: string | null
  total_revenue: number
  total_qty: number
  months_sold: number
  price_min: number
  price_max: number
  price_avg: number
  price_variance_pct: number // (max-min)/avg * 100
  tiers: ElasticityTier[]
  /** -1 to 1: +1 demand rises with price (inelastic), -1 demand drops (elastic), 0 flat */
  elasticity_signal: number
  recommendation: 'raise' | 'hold' | 'lower' | 'investigate'
}

export interface ElasticityReport {
  items: ElasticityRow[]
  year_range: { from: number; to: number }
  generated_at: string
}

function bucket(
  points: PricePoint[],
): { low: PricePoint[]; mid: PricePoint[]; high: PricePoint[]; range: [number, number] } {
  const prices = points.map(p => p.unit_price).sort((a, b) => a - b)
  const min = prices[0]
  const max = prices[prices.length - 1]
  const range = max - min
  const t1 = min + range / 3
  const t2 = min + (range * 2) / 3
  return {
    low: points.filter(p => p.unit_price <= t1),
    mid: points.filter(p => p.unit_price > t1 && p.unit_price <= t2),
    high: points.filter(p => p.unit_price > t2),
    range: [min, max],
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

function signal(tiers: ElasticityTier[]): {
  s: number
  rec: ElasticityRow['recommendation']
} {
  const low = tiers.find(t => t.label === 'low')
  const high = tiers.find(t => t.label === 'high')
  if (!low || !high || low.months === 0 || high.months === 0) {
    return { s: 0, rec: 'investigate' }
  }
  // If demand stays strong at high prices, we have price-inelastic demand (raise)
  const ratio = high.avg_qty / low.avg_qty // <1 means demand fell at higher prices
  // Normalize to -1..1: ratio=1 → 0, ratio=2 → +0.5, ratio=0.5 → -0.5
  const s = Math.max(-1, Math.min(1, (ratio - 1) / 1.5))
  let rec: ElasticityRow['recommendation'] = 'hold'
  if (s > 0.2) rec = 'raise' // demand actually rose at higher prices
  else if (s > -0.2) rec = 'raise' // demand held — safe to raise
  else if (s > -0.5) rec = 'hold' // demand dropped moderately
  else rec = 'lower' // demand dropped sharply
  return { s, rec }
}

export async function getPriceElasticity(
  topN = 50,
  minMonths = 6,
): Promise<ElasticityReport> {
  // Pull monthly_sales for items with sufficient history
  const result = await query(
    `
    SELECT
      item_code,
      MAX(item_name) AS item_name,
      year, month,
      quantity::float AS qty,
      revenue::float AS revenue
    FROM dashboard.monthly_sales
    WHERE quantity::float > 0 AND revenue::float > 0
    GROUP BY item_code, year, month, quantity, revenue
    ORDER BY item_code, year, month
    `,
  )

  // Group by item_code
  const byItem = new Map<
    string,
    { name: string | null; points: PricePoint[] }
  >()
  for (const row of result.rows) {
    const code = row.item_code as string
    const qty = Number(row.qty)
    const revenue = Number(row.revenue)
    const entry = byItem.get(code) || { name: row.item_name, points: [] as PricePoint[] }
    entry.points.push({
      year: Number(row.year),
      month: Number(row.month),
      qty,
      revenue,
      unit_price: revenue / qty,
    })
    byItem.set(code, entry)
  }

  // Compute per-item stats
  const rows: ElasticityRow[] = []
  for (const [code, { name, points }] of byItem.entries()) {
    if (points.length < minMonths) continue

    const total_qty = points.reduce((s, p) => s + p.qty, 0)
    const total_revenue = points.reduce((s, p) => s + p.revenue, 0)
    const prices = points.map(p => p.unit_price)
    const price_min = Math.min(...prices)
    const price_max = Math.max(...prices)
    const price_avg = avg(prices)
    const price_variance_pct =
      price_avg > 0 ? ((price_max - price_min) / price_avg) * 100 : 0

    // Skip items with no meaningful price variation
    if (price_variance_pct < 5) continue

    const b = bucket(points)
    const lowRange: [number, number] = [
      b.low.length > 0 ? Math.min(...b.low.map(p => p.unit_price)) : price_min,
      b.low.length > 0 ? Math.max(...b.low.map(p => p.unit_price)) : price_min,
    ]
    const midRange: [number, number] = [
      b.mid.length > 0 ? Math.min(...b.mid.map(p => p.unit_price)) : price_avg,
      b.mid.length > 0 ? Math.max(...b.mid.map(p => p.unit_price)) : price_avg,
    ]
    const highRange: [number, number] = [
      b.high.length > 0 ? Math.min(...b.high.map(p => p.unit_price)) : price_max,
      b.high.length > 0 ? Math.max(...b.high.map(p => p.unit_price)) : price_max,
    ]
    const tiers: ElasticityTier[] = [
      {
        label: 'low',
        price_range: lowRange,
        avg_qty: avg(b.low.map(p => p.qty)),
        months: b.low.length,
      },
      {
        label: 'mid',
        price_range: midRange,
        avg_qty: avg(b.mid.map(p => p.qty)),
        months: b.mid.length,
      },
      {
        label: 'high',
        price_range: highRange,
        avg_qty: avg(b.high.map(p => p.qty)),
        months: b.high.length,
      },
    ]
    const { s, rec } = signal(tiers)

    rows.push({
      item_code: code,
      item_name: name,
      total_revenue,
      total_qty,
      months_sold: points.length,
      price_min,
      price_max,
      price_avg,
      price_variance_pct,
      tiers,
      elasticity_signal: s,
      recommendation: rec,
    })
  }

  // Sort by total revenue desc, take top N
  rows.sort((a, b) => b.total_revenue - a.total_revenue)
  const top = rows.slice(0, topN)

  // Year range from points
  let fromYear = Infinity
  let toYear = -Infinity
  for (const { points } of byItem.values()) {
    for (const p of points) {
      if (p.year < fromYear) fromYear = p.year
      if (p.year > toYear) toYear = p.year
    }
  }

  return {
    items: top,
    year_range: {
      from: Number.isFinite(fromYear) ? fromYear : 0,
      to: Number.isFinite(toYear) ? toYear : 0,
    },
    generated_at: new Date().toISOString(),
  }
}
