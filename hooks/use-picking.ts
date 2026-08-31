'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * Where this row points in the rest of the dashboard.
 *
 * Null when the document could not be resolved in the ERP mirror — a row newer
 * than the mirror, or a format the split does not recognise. The page renders
 * those as plain text; an unresolved row must never become a link to a guess.
 */
export interface DocRef {
  format: string
  docNumber: string
  year: string | null
  customerCode: string | null
  customerName: string | null
}

export interface PickOrder {
  document_number: string
  doc?: DocRef | null
  status: string
  priority: string
  shipping_method: string | null
  created_at: string | null
}

export interface DisputeGroup {
  sku: string
  description: string
  times: number
  quantityShort: number
  lastAt: string | null
  reasons: string[]
  labelLocation: string | null
}

export interface ShippedOrder {
  document_number: string
  doc?: DocRef | null
  customer_name: string | null
  /** Selected by lib/invagent's query and searchable here; no column shows it. */
  shipping_method: string | null
  items_count: number
  total_quantity: number
  pick_duration_seconds: number | null
  shipped_at: string
}

export interface PickingResponse {
  sourceAvailable: boolean
  reason?: string
  queue: PickOrder[]
  /** The queue hit its fetch cap — `queue.length` is a floor, not a total. */
  queueCapped?: boolean
  disputes: { lines: number; bySku: DisputeGroup[] }
  shipped: { orders: ShippedOrder[]; timedOrders: number; avgPickSeconds: number | null }
}

/**
 * The warehouse picking floor.
 *
 * The route answers 503 when the warehouse app could not be CONSULTED at all —
 * which is not the same as an idle floor, and must not be smoothed into empty
 * arrays here. Every table in that Supabase is RLS-scoped and answers an
 * unprivileged read with `[]`, so "nothing to pick" is exactly the wrong answer
 * to fall back to. The error is thrown and the page shows it.
 */
export function usePicking(from?: string, to?: string) {
  return useQuery<PickingResponse>({
    queryKey: ['picking-floor', from ?? '', to ?? ''],
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const res = await fetch(`/api/picking${qs.toString() ? `?${qs}` : ''}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.reason || 'לא ניתן להגיע לאפליקציית הליקוט')
      return body
    },
    // The floor moves minute to minute — a stale queue sends someone to an
    // order that is already out the door.
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
}
