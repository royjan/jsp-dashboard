'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/** Shapes from /api/service-kits (lib/service-kits-server.ts has the schema). */
export interface KitItem {
  id: number
  kit_id: string
  sort: number
  part_en: string
  part_he: string
  match_he: string[] | null
  source: 'catalog' | 'fluid'
  fluid: string | null
  qty: number
  unit: 'pcs' | 'L'
  qty_from: string | null
  every_km: number
  every_months: number | null
  needs: string | null
  basic: boolean
  optional: boolean
  note_he: string | null
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

export interface ServiceKit {
  id: string
  name: string
  fuel_types: string[] | null
  makes: string[] | null
  priority: number
  is_active: boolean
  created_by: string | null
  updated_at: string
  items: KitItem[]
}

export interface KitProduct {
  id: number
  fluid: string
  grade: string
  pack_l: number
  item_code: string
  makes: string[] | null
  sort: number
  note: string | null
  updated_at: string | null
  updated_by: string | null
}

export interface ErpItem { name: string | null; stock_qty: number; incoming_qty: number; price: number | null }

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
  return body as T
}

const KEY = ['service-kits']

export function useServiceKits() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => j<{ kits: ServiceKit[]; products: KitProduct[] }>(await fetch('/api/service-kits')),
  })
}

export type Entity = 'kit' | 'item' | 'product'

export function useKitWrite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { method: 'POST' | 'PUT' | 'DELETE'; entity: Entity; id?: string | number; data?: Record<string, unknown> }) =>
      j<{ ok: true; id?: string | number }>(v.method === 'DELETE'
        ? await fetch(`/api/service-kits?entity=${v.entity}&id=${encodeURIComponent(String(v.id))}`, { method: 'DELETE' })
        : await fetch('/api/service-kits', {
            method: v.method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity: v.entity, id: v.id, ...v.data }),
          })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useErpItems(codes: string[]) {
  const sorted = [...new Set(codes.map((c) => c.toUpperCase()))].sort()
  return useQuery({
    queryKey: ['service-kits-erp', sorted.join(',')],
    enabled: sorted.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => (await j<{ items: Record<string, ErpItem | null> }>(
      await fetch(`/api/service-kits/lookup?codes=${encodeURIComponent(sorted.join(','))}`))).items,
  })
}

/** The peer's rule (peers/service/server.py service_km + due_items), for the km preview. */
export function serviceKm(km: number | null, items: KitItem[]): number | null {
  if (km === null) return null
  const base = items.length ? Math.min(...items.map((i) => i.every_km)) : 15000
  // Python's round(): halves go to the even neighbour (37,500 at base 15k -> 30k, not 45k)
  const x = km / base, f = Math.floor(x)
  const r = x - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x)
  return Math.max(base, r * base)
}

export function dueItems(items: KitItem[], n: number | null): KitItem[] {
  return n === null ? items.filter((i) => i.basic) : items.filter((i) => n % i.every_km === 0)
}
