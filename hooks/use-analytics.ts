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
  })
}

export function useSalesAnalytics(period: Period = '30d') {
  return useQuery({
    queryKey: ['sales', period],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/sales?period=${period}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
}

export function useSeasonalData() {
  return useQuery({
    queryKey: ['seasonal'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/seasonal')
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

export function useReorderRecommendations() {
  return useQuery({
    queryKey: ['reorder'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/reorder')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
}
