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
}

export interface MarginResponse {
  summary: {
    total_revenue: number
    total_quantity: number
    items_evaluated: number
    est_gross_margin_pct: number | null
  }
  byCategory: MarginCategory[]
  byItem: MarginItem[]
  cost_available: boolean
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
