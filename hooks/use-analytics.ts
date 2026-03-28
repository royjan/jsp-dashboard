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

export function useSeasonalItems(dateFrom?: string, dateTo?: string, ai = false) {
  return useQuery({
    queryKey: ['seasonal-items', dateFrom, dateTo, ai],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (ai) params.set('ai', 'true')
      const res = await fetch(`/api/analytics/seasonal/items?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 6 * 60 * 60 * 1000,
    enabled: true,
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
    staleTime: 5 * 60 * 1000,
    retry: 2,
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
    staleTime: 5 * 60 * 1000,
    retry: 2,
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
    staleTime: 5 * 60 * 1000,
    retry: 2,
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
    staleTime: 5 * 60 * 1000,
    retry: 2,
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
