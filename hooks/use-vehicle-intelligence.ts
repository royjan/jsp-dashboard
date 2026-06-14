'use client'

import { useQuery } from '@tanstack/react-query'

export function useVehiclePopulation() {
  return useQuery({
    queryKey: ['vehicle-population'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/vehicle-population')
      if (!res.ok) throw new Error('Failed to fetch vehicle population')
      return res.json()
    },
    staleTime: 30 * 60 * 1000, // 30 min
    gcTime: 60 * 60 * 1000,    // 1 hour
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useVehicleDemand(make: string, model: string, yearRange: string) {
  return useQuery({
    queryKey: ['vehicle-demand', make, model, yearRange],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (make) params.set('make', make)
      if (model) params.set('model', model)
      if (yearRange) params.set('year_range', yearRange)
      const res = await fetch(`/api/analytics/vehicle-population/demand?${params}`)
      if (!res.ok) throw new Error('Failed to fetch demand prediction')
      return res.json()
    },
    // Only fetch when at least one filter is set, or on initial load
    enabled: true,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useVehicleLifecycle() {
  return useQuery({
    queryKey: ['vehicle-lifecycle'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/vehicle-population/lifecycle')
      if (!res.ok) throw new Error('Failed to fetch lifecycle data')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
