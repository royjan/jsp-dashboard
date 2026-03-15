'use client'

import { useQuery } from '@tanstack/react-query'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard')
      if (!res.ok) throw new Error('Failed to fetch dashboard')
      return res.json()
    },
    refetchInterval: 5 * 60 * 1000,
  })
}

export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: async () => {
      const res = await fetch('/api/items')
      if (!res.ok) throw new Error('Failed to fetch items')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
  })
}
