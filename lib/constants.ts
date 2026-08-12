// Document format codes in Finansit
export const DOC_FORMATS = {
  QUOTE: 31,
  TAX_INVOICE: 11,
  DELIVERY_NOTE: 2,
  CREDIT_INVOICE: 12,
  PURCHASE_ORDER: 21,
  RECEIPT: 41,
} as const

// Israeli seasons mapping
export const ISRAELI_SEASONS = {
  SUMMER: { months: [5, 6, 7, 8, 9, 10], label: 'Summer', icon: '☀️' },
  WINTER: { months: [11, 12, 1, 2, 3, 4], label: 'Winter', icon: '🌧️' },
} as const

// Seasonal product categories
export const SEASONAL_CATEGORIES = {
  summer: ['AC Compressors', 'AC Filters', 'Coolant', 'Radiators', 'Belts', 'Water Pumps'],
  winter: ['Wiper Blades', 'Brake Pads', 'Batteries', 'Headlights', 'Heater Parts'],
} as const

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

// Cache key versions — bump here when data shape changes, all consumers read from this single place
export const CACHE_VERSIONS = {
  ITEMS_ENRICHED: 'items:enriched:v13',
  COMPETITOR_COMPARE: 'competitors:compare:v1',
} as const

// Redis cache TTLs (in seconds)
// Cron warms cache every 2h during business hours; TTLs just need to survive the gap
export const CACHE_TTL = {
  DASHBOARD: 3 * 60 * 60,    // 3 hours (refreshed every 2h by cron)
  ITEMS: 3 * 60 * 60,        // 3 hours
  DOCUMENTS: 3 * 60 * 60,    // 3 hours
  ANALYTICS: 3 * 60 * 60,    // 3 hours
  SEASONAL: 48 * 60 * 60,    // 48 hours (changes rarely, survives weekend)
  AI_INSIGHTS: 2 * 60 * 60,  // 2 hours
} as const

// ── Reorder urgency ──
//
// `urgency_score` comes from getReorderRecommendations():
//   (asked_qty * 3 + sold_qty * 2) / max(pipeline, 1) * recencyBoost * flagBoost
// where asked_qty/sold_qty are real quote/invoice line quantities from FINAPI's
// recommendation report.
//
// Why 50 and not the old 5: the `* 3` term used to be inquiry_count, which the
// paged /api/items endpoint returns as 0 for every item — so the numerator was
// missing its heaviest signal and `> 5` happened to select the top ~1.2%. With
// real quote demand in it, the same 98.8th percentile sits at ~52.7. Measured on
// a live 90-day report (7874 rows, 2026-05-13..08-11): `> 5` flags 4391 items
// (55.8% — meaningless as "urgent"), `> 50` flags 97, vs 91 under the old formula.
// Band edges are the old 2/5/10/20 mapped through matching percentiles
// (p84.1/p98.8/p99.7/p99.9 → 14/52.7/84.2/128.7), rounded. Re-derive if the
// weights change.
export const URGENCY_URGENT_THRESHOLD = 50

export const URGENCY_BANDS = {
  watch: 15,      // was 2
  high: 50,       // was 5  — same edge as URGENCY_URGENT_THRESHOLD
  critical: 85,   // was 10
  severe: 130,    // was 20
} as const

export type UrgencyBand = 'low' | 'watch' | 'high' | 'critical' | 'severe'

export function isUrgent(score: number | null | undefined): boolean {
  return (score ?? 0) > URGENCY_URGENT_THRESHOLD
}

export function urgencyBand(score: number | null | undefined): UrgencyBand {
  const s = score ?? 0
  if (s >= URGENCY_BANDS.severe) return 'severe'
  if (s >= URGENCY_BANDS.critical) return 'critical'
  if (s >= URGENCY_BANDS.high) return 'high'
  if (s >= URGENCY_BANDS.watch) return 'watch'
  return 'low'
}

// Currency formatting
export const ILS_FORMAT = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export const NUMBER_FORMAT = new Intl.NumberFormat('en-IL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * Format a number with thousands separators (1,234,567).
 * Use everywhere a magnitude/quantity/count/currency is shown to the user.
 * NOTE: do NOT use for years (2026), item codes, doc numbers or indices —
 * those must stay un-grouped.
 */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Format as ILS currency with thousands separators (₪1,234,567). */
export function formatCurrency(value: number | null | undefined, decimals = 0): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '₪0'
  return n.toLocaleString('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
