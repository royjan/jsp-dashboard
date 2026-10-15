'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/** Shapes from /api/bot-suppliers (lib/bot-suppliers-server.ts has the schema). */
export interface BotSupplierSettings {
  enabled: boolean
  show_price: boolean
  price_field: 'net' | 'gross'
  show_stock: boolean
  label: string | null
  max_alts: number
}

export interface BotSupplier {
  supplier_code: string
  name: string
  name_he: string | null
  adapter: string
  enabled: boolean
  parts: number
  oems: number
  in_stock: number
  data_at: string | null
  source: string | null
  /** null = this supplier is not connected to the bot */
  bot: BotSupplierSettings | null
}

export interface SupplierPart {
  brand: string
  part_no: string
  description: string | null
  price_gross: number | null
  price_net: number | null
  discount_pct: number | null
  in_stock: boolean | null
  stock_text: string | null
  updated_at: string
  oems: string[]
}

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
  return body as T
}

export function useBotSuppliers(bot: string) {
  return useQuery({
    queryKey: ['bot-suppliers', bot],
    queryFn: async () => (await j<{ suppliers: BotSupplier[] }>(await fetch(`/api/bot-suppliers?bot=${encodeURIComponent(bot)}`))).suppliers,
  })
}

export function useSaveBotSupplier(bot: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { supplier_code: string } & Partial<BotSupplierSettings>) =>
      j(await fetch('/api/bot-suppliers', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bot, ...v }),
      })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-suppliers', bot] }),
  })
}

export function useSupplierParts(supplier: string, q: string, offset: number) {
  return useQuery({
    queryKey: ['supplier-parts', supplier, q, offset],
    enabled: !!supplier,
    queryFn: async () => j<{ total: number; offset: number; limit: number; items: SupplierPart[] }>(
      await fetch(`/api/bot-suppliers/parts?supplier=${encodeURIComponent(supplier)}&q=${encodeURIComponent(q)}&offset=${offset}&limit=50`)),
  })
}

export function useUploadSupplier(bot: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (form: FormData) => {
      form.set('bot', bot)
      return j<{ items: number; oem_links: number; in_stock: number; sheet: string }>(
        await fetch('/api/bot-suppliers/upload', { method: 'POST', body: form }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bot-suppliers', bot] })
      qc.invalidateQueries({ queryKey: ['supplier-parts'] })
    },
  })
}
