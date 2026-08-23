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
    // While the ICS scan runs in the background the route answers `warming`
    // with empty data. Poll until it lands, then stop — without this the page
    // stays empty until the user reloads.
    refetchInterval: (q) => (q.state.data?.warming ? 5_000 : false),
    staleTime: 30 * 60 * 1000, // 30 min
    gcTime: 60 * 60 * 1000,    // 1 hour
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

