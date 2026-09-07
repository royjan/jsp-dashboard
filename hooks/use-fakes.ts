'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import type { FakesResponse, LiveCostResponse } from '@/app/api/competitors/fakes/route'
import type { PriceCheckResponse } from '@/app/api/competitors/price-check/route'

/**
 * The counterfeit-suspect scan. One DB query behind it (~150ms), so this is
 * deliberately not cached hard: the interesting number changes when someone
 * uploads a new competitor sheet, and a stale answer here is an accusation.
 */
export function useFakeCandidates() {
  return useQuery<FakesResponse>({
    queryKey: ['competitor-fakes'],
    queryFn: async () => {
      const res = await fetch('/api/competitors/fakes')
      if (!res.ok) throw new Error('Failed to load counterfeit scan')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

/**
 * Re-cost codes against FINAPI. A mutation rather than a query because it
 * costs real ERP round trips and only runs when someone asks for it.
 */
export function useLiveCosts() {
  return useMutation<LiveCostResponse, Error, string[]>({
    mutationFn: async codes => {
      const res = await fetch('/api/competitors/fakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to fetch live costs')
      }
      return res.json()
    },
  })
}

/** Look up pasted codes: our cost, our price, our stock, best competitor. */
export function usePriceCheck() {
  return useMutation<PriceCheckResponse, Error, string[]>({
    mutationFn: async codes => {
      const res = await fetch('/api/competitors/price-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to check prices')
      }
      return res.json()
    },
  })
}
