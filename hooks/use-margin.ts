'use client'

import { useQuery } from '@tanstack/react-query'

export interface MarginCategory {
  category: string
  revenue: number
  quantity: number
  avg_price: number
  item_count: number
  margin_pct: number | null
}

export interface MarginItem {
  item_code: string
  item_name: string | null
  category: string | null
  revenue: number
  quantity: number
  avg_price: number
  margin_pct: number | null
  /** Per-unit cost from price list 06. null = the item was not in FINAPI's cost pool,
   *  or has no 06 row at all — NOT a cost of zero. */
  cost?: number | null
  /** Shekels earned: revenue − cost × qty. null whenever cost is null. */
  profit?: number | null
  /** Date of the 06 row used. Stale costs still compute; they are flagged, not hidden. */
  cost_date?: string | null
  cost_stale?: boolean
  /** Implausible cost (sub-shekel behind a three-figure sale) — kept out of rankings. */
  cost_suspect?: boolean
  /** Price list 12 (נטו/agent) carried alongside. Frozen in the ERP since 2026-03-29. */
  compare_price?: number | null
  compare_margin_pct?: number | null
  /** realised margin − list-12 margin. Positive = selling above what list 12 would give. */
  compare_gap?: number | null
  in_cost_pool?: boolean
}

export interface MarginFreshness {
  sales_source: string
  cost_price_code: string
  cost_newest_date: string | null
  cost_stale_items: number
  compare_price_code: string | null
  compare_newest_date: string | null
  compare_stale_items: number
  stale_after_days: number
}

export interface MarginResponse {
  summary: {
    total_revenue: number
    total_quantity: number
    items_evaluated: number
    est_gross_margin_pct: number | null
    gross_profit?: number | null
    cost_of_goods?: number | null
    costed_revenue?: number | null
    items_costed?: number
    /** How many items got a live cost lookup. Every ranking below is scoped to it. */
    cost_pool?: number
    coverage_pct?: number
    suspect_cost_items?: number
  }
  byCategory: MarginCategory[]
  byItem: MarginItem[]
  /** Top margin % — revenue-floored, so a single tiny sale at 95% cannot win. */
  bestMargin?: MarginItem[]
  /** Top profit in shekels. Rarely the same items as bestMargin. */
  bestProfit?: MarginItem[]
  belowCost?: { count: number; lost_profit: number | null; items: MarginItem[] }
  /** Margin histogram from FINAPI: bucket → { items, revenue, profit }. */
  distribution?: Record<string, { items: number; revenue: number; profit: number }> | null
  freshness?: MarginFreshness | null
  cost_available: boolean
  costed_item_count?: number
  note_he?: string
  note_en?: string
  error?: string
}

export function useMargin() {
  return useQuery<MarginResponse>({
    queryKey: ['margin-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/margin')
      if (!res.ok) throw new Error('Failed to fetch margin analytics')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
