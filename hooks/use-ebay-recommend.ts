'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useEbayRecommendations() {
  return useQuery({
    queryKey: ['ebay-recommendations'],
    queryFn: async () => {
      const res = await fetch('/api/ebay/recommend')
      if (!res.ok) return { items: [] }
      return res.json() as Promise<{ items: string[] }>
    },
    staleTime: 60 * 1000,
    retry: 1,
  })
}

export function useToggleEbayRecommend() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ itemCode, itemName, source, isRecommended }: {
      itemCode: string
      itemName?: string
      source?: string
      isRecommended: boolean
    }) => {
      if (isRecommended) {
        const res = await fetch(`/api/ebay/recommend?item_code=${encodeURIComponent(itemCode)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('Failed to remove')
        return res.json()
      } else {
        const res = await fetch('/api/ebay/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_code: itemCode, item_name: itemName, source }),
        })
        if (!res.ok) throw new Error('Failed to recommend')
        return res.json()
      }
    },
    onMutate: async ({ itemCode, isRecommended }) => {
      await queryClient.cancelQueries({ queryKey: ['ebay-recommendations'] })
      const previous = queryClient.getQueryData<{ items: string[] }>(['ebay-recommendations'])

      // Optimistic update
      queryClient.setQueryData(['ebay-recommendations'], {
        items: isRecommended
          ? (previous?.items || []).filter(c => c !== itemCode)
          : [...(previous?.items || []), itemCode],
      })

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['ebay-recommendations'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay-recommendations'] })
    },
  })
}
