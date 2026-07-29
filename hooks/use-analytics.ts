'use client'

import { useQuery } from '@tanstack/react-query'
import type { Period } from '@/lib/types'

export function useDemandAnalysis(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['demand', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/analytics/demand?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useDemandOverview(days = 30) {
  return useQuery({
    queryKey: ['demand-overview', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/demand?view=overview&days=${days}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useEbayAnalytics() {
  return useQuery({
    queryKey: ['ebay-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/ebay')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useReturnsAnalysis() {
  return useQuery({
    queryKey: ['returns-analysis'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/returns')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useChatInsights(days = 30) {
  return useQuery({
    queryKey: ['chat-insights', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/chat-insights?days=${days}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useMarketAnalytics() {
  return useQuery({
    queryKey: ['market-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/market')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useCrossPlatformKpis() {
  return useQuery({
    queryKey: ['cross-platform-kpis'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/cross-platform')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useSalesAnalytics(period: Period = '30d', enabled = true) {
  return useQuery({
    queryKey: ['sales', period],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/sales?period=${period}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled,
  })
}

export function useSalesRange(dateFrom: string, dateTo: string, enabled = true) {
  return useQuery({
    queryKey: ['sales-range', dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/sales?date_from=${dateFrom}&date_to=${dateTo}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled,
  })
}

export function useSeasonalData(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['seasonal', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/analytics/seasonal?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 6 * 60 * 60 * 1000,
  })
}

export function useSeasonalItems(dateFrom?: string, dateTo?: string, ai = false, refreshTick = 0) {
  return useQuery({
    queryKey: ['seasonal-items', dateFrom, dateTo, ai, refreshTick],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (ai) params.set('ai', 'true')
      // refreshTick > 0 means the user hit "refresh" — bypass the server cache.
      if (refreshTick > 0) params.set('refresh', 'true')
      const res = await fetch(`/api/analytics/seasonal/items?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 6 * 60 * 60 * 1000,
    enabled: true,
  })
}

export function useItemDocuments(code: string, type: string | null) {
  return useQuery({
    queryKey: ['item-documents', code, type],
    queryFn: async () => {
      const res = await fetch(`/api/items/${encodeURIComponent(code)}/documents?type=${type}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code && !!type,
    staleTime: 5 * 60 * 1000,
  })
}

export function useSeasonalItemsByMonth(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['seasonal-items-by-month', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/analytics/seasonal/items-by-month?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 6 * 60 * 60 * 1000,
  })
}

export function useDeadStock(years: number = 1) {
  return useQuery({
    queryKey: ['dead-stock', years],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/dead-stock?years=${years}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useTopSellingItems(period: Period = '30d') {
  return useQuery({
    queryKey: ['top-items', period],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/top-items?period=${period}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
}

export function useReorderRecommendations(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['reorder', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const qs = params.toString()
      const res = await fetch(`/api/analytics/reorder${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useConversionAnalysis(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['conversion', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/analytics/conversion?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useABCClassification(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['abc', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const qs = params.toString()
      const res = await fetch(`/api/analytics/abc${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useDeadStockSearch(query: string) {
  return useQuery({
    queryKey: ['dead-stock-search', query],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/dead-stock/search?q=${encodeURIComponent(query)}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: query.length >= 2,
    staleTime: 5 * 60 * 1000,
  })
}

export function useBusinessReport() {
  return useQuery({
    queryKey: ['business-report'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/business-report')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    retry: 2,
  })
}

export function useCustomerAnalytics(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['customers', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/analytics/customers?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useCustomerHealth(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['customer-health', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/analytics/customer-health?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

export function useHealthTransitions(direction?: string) {
  return useQuery({
    queryKey: ['health-transitions', direction],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (direction && direction !== 'all') params.set('direction', direction)
      params.set('limit', '100')
      const res = await fetch(`/api/analytics/customer-health/transitions?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: true,
  })
}

export function useUnacknowledgedCount() {
  return useQuery({
    queryKey: ['health-transitions-unack-count'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/customer-health/transitions?direction=unacknowledged&limit=1')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return data.unacknowledgedDeterioratingCount ?? 0
    },
    staleTime: 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000, // poll every 5 min
  })
}

export function useReceivables(limit = 50) {
  return useQuery({
    queryKey: ['receivables', limit],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/receivables?limit=${limit}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useGapAnalysis(format = '31', limit = 200) {
  return useQuery({
    queryKey: ['gap-analysis', format, limit],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/gap?format=${format}&limit=${limit}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useFollowUpStats(daysBack = 3) {
  return useQuery({
    queryKey: ['followup-stats', daysBack],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/followups?days_back=${daysBack}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useCustomerDetail(code: string | null) {
  return useQuery({
    queryKey: ['customer-detail', code],
    queryFn: async () => {
      const res = await fetch(`/api/customers?code=${code}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code,
    staleTime: 2 * 60 * 1000,
    retry: 2,
  })
}

export function useCustomerHistory(code: string | null) {
  return useQuery({
    queryKey: ['customer-history', code],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${encodeURIComponent(code!)}/history`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code,
    staleTime: 10 * 60 * 1000,
    // The cold path is a long FINAPI scan — one retry is plenty.
    retry: 1,
  })
}

export function useItemDetail(code: string | null) {
  return useQuery({
    queryKey: ['item-detail', code],
    queryFn: async () => {
      const res = await fetch(`/api/items/${encodeURIComponent(code!)}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

/**
 * Search and sort are sent to the server so they apply to the whole result
 * set, not just the `limit` rows already in the browser. `placeholderData`
 * keeps the previous page visible while a re-sort is in flight instead of
 * flashing the loading skeleton.
 */
export function useStockForecast(
  urgency?: string,
  limit = 50,
  opts?: { q?: string; sort?: string; dir?: 'asc' | 'desc' },
) {
  const { q = '', sort = '', dir = 'asc' } = opts || {}
  return useQuery({
    queryKey: ['stock-forecast', urgency, limit, q, sort, dir],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) })
      if (urgency) params.set('urgency', urgency)
      if (q) params.set('q', q)
      if (sort) { params.set('sort', sort); params.set('dir', dir) }
      const res = await fetch(`/api/analytics/stock-forecast?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    placeholderData: (prev) => prev,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useItemStockForecast(itemCode: string | null) {
  return useQuery({
    queryKey: ['stock-forecast-item', itemCode],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/stock-forecast/${encodeURIComponent(itemCode!)}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!itemCode,
    staleTime: 30 * 60 * 1000,
    retry: 2,
  })
}

// Purchase-row drill-down: which invoices of this customer contain the item in
// the days window. First uncached customer fans out doc-detail fetches server-
// side (can take tens of seconds) — one retry, no focus refetch.
export function useCustomerItemInvoices(
  customerCode: string | null,
  itemCode: string | null,
  days = 90,
  // Expected match count (the row's line_count) lets the server stop scanning
  // early. Pass 0 to force a full-window scan (e.g. when returns exist).
  expected = 0
) {
  return useQuery({
    queryKey: ['customer-item-invoices', customerCode, itemCode, days],
    queryFn: async () => {
      const res = await fetch(
        `/api/customers/${encodeURIComponent(customerCode!)}/purchases/${encodeURIComponent(itemCode!)}?days=${days}&expected=${expected}`
      )
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!customerCode && !!itemCode,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useDocumentDetail(format: string | null, number: string | null, year?: string) {
  return useQuery({
    queryKey: ['document-detail', format, number, year ?? ''],
    queryFn: async () => {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(format!)}/${encodeURIComponent(number!)}${year ? `?year=${year}` : ''}`
      )
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!format && !!number,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })
}

export function useCustomerPurchases(code: string | null, days = 90) {
  return useQuery({
    queryKey: ['customer-purchases', code, days],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${encodeURIComponent(code!)}/purchases?days=${days}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}
