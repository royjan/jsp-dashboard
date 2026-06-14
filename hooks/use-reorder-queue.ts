'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReorderQueueItem } from '@/lib/db/schema'

export type ReorderStage = 'suggested' | 'approved' | 'ordered' | 'received'

export interface ReorderQueueData {
  suggested: ReorderQueueItem[]
  approved: ReorderQueueItem[]
  ordered: ReorderQueueItem[]
  received: ReorderQueueItem[]
}

const QUERY_KEY = ['reorder-queue']

export function useReorderQueue() {
  return useQuery<ReorderQueueData>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/reorder/queue')
      if (!res.ok) throw new Error('Failed to fetch reorder queue')
      return res.json()
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useMoveItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, stage, approvedQty }: { id: number; stage: ReorderStage; approvedQty?: number }) => {
      const body: any = { stage }
      if (approvedQty !== undefined) body.approvedQty = approvedQty
      const res = await fetch(`/api/reorder/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to update item')
      return res.json()
    },
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY })
      const previous = queryClient.getQueryData<ReorderQueueData>(QUERY_KEY)

      if (previous) {
        // Find the item across all stages
        let item: ReorderQueueItem | undefined
        let fromStage: ReorderStage | undefined

        for (const s of ['suggested', 'approved', 'ordered', 'received'] as ReorderStage[]) {
          const found = previous[s].find(i => i.id === id)
          if (found) {
            item = found
            fromStage = s
            break
          }
        }

        if (item && fromStage) {
          const updated: ReorderQueueData = { ...previous }
          updated[fromStage] = previous[fromStage].filter(i => i.id !== id)
          updated[stage] = [...previous[stage], { ...item, stage }]
          queryClient.setQueryData(QUERY_KEY, updated)
        }
      }

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useUpdateItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number; approvedQty?: number; notes?: string; supplierInfo?: string }) => {
      const res = await fetch(`/api/reorder/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update item')
      return res.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useDeleteItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/reorder/queue/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete item')
      return res.json()
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY })
      const previous = queryClient.getQueryData<ReorderQueueData>(QUERY_KEY)

      if (previous) {
        const updated: ReorderQueueData = {
          suggested: previous.suggested.filter(i => i.id !== id),
          approved: previous.approved.filter(i => i.id !== id),
          ordered: previous.ordered.filter(i => i.id !== id),
          received: previous.received.filter(i => i.id !== id),
        }
        queryClient.setQueryData(QUERY_KEY, updated)
      }

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useGenerateSuggestions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reorder/generate', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to generate suggestions')
      return res.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useClearReceived() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reorder/queue?stage=received', { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to clear received items')
      return res.json()
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY })
      const previous = queryClient.getQueryData<ReorderQueueData>(QUERY_KEY)
      if (previous) {
        queryClient.setQueryData(QUERY_KEY, { ...previous, received: [] })
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}
