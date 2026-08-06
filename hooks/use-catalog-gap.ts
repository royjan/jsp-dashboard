'use client'

import { useQuery } from '@tanstack/react-query'
import type { CatalogGapResponse } from '@/app/api/analytics/catalog-gap/route'
import type { CatalogGapProject } from '@/app/api/analytics/catalog-gap/projects/route'

/**
 * The query string IS the request — filtering, ordering and paging all happen
 * server-side, so each distinct view is its own cache entry. `placeholderData`
 * keeps the current rows on screen while a filter change loads, instead of
 * flashing the skeleton on every keystroke.
 *
 * staleTime is generous (15 min): the underlying data only moves when a new VIN
 * is scanned, and the query costs ~2s.
 */
export function useCatalogGap(params: string) {
  return useQuery<CatalogGapResponse>({
    queryKey: ['catalog-gap', params],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/catalog-gap${params ? `?${params}` : ''}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load catalog gap')
      }
      return res.json()
    },
    placeholderData: previous => previous,
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useCatalogGapProjects() {
  return useQuery<{ projects: CatalogGapProject[] }>({
    queryKey: ['catalog-gap-projects'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/catalog-gap/projects')
      if (!res.ok) throw new Error('Failed to load vehicles')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
