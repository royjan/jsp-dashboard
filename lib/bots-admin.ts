'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/** Shapes returned by bot-admin (claude-work/bot-admin/bot_admin.py) through /api/bots. */
export interface BotPolicy {
  daily_limit_per_user?: number
  limit_reply?: string
  allow_list?: string[]
  allow_reply?: string
  show_prices?: boolean
  exempt_channels?: string[]
  telegram_auth?: 'none' | 'phone' | 'code' | 'phone_or_code'
  access_code?: string
}

export interface BotBrands {
  CATALOG_ONLY_BRANDS: string
  CATALOG_ONLY_BRANDS_REPLY: string
  CATALOG_CAR_REFUSE_BRANDS: string
}

export interface BotTelegram {
  token_set: boolean
  running: boolean
  conflicts: number
  username?: string
  name?: string
  error?: string
}

export interface BotOverview {
  id: string
  name: string
  description: string
  web_url: string
  status: 'up' | 'partial' | 'down'
  containers: { name: string; state: string; status: string }[]
  memory_mb: number | null
  brands: BotBrands
  policy: BotPolicy
  telegram: BotTelegram
  today: { questions: number; ok: number }
  week: { questions: number; ok: number; median_s: number | null }
}

export interface BotStats {
  bot: string
  days: number
  questions: number
  ok: number
  errors: number
  refused: Record<string, number>
  unique_users: number
  channels: Record<string, number>
  latency_s: { median: number | null; p90: number | null }
  per_day: { day: string; questions: number; ok: number; errors: number; refused: number }[]
  top_words: [string, number][]
}

export interface BotTurn {
  ts: number
  channel: string
  sender: string
  question: string
  answer: string
  ok: boolean
  elapsed_s: string | number | null
  error: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, { cache: 'no-store', ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body as T
}

export function useBots() {
  return useQuery({ queryKey: ['bots'], queryFn: () => call<BotOverview[]>('bots'), refetchInterval: 30_000 })
}

export function useBot(id: string) {
  return useQuery({ queryKey: ['bots', id], queryFn: () => call<BotOverview>(`bots/${id}`), refetchInterval: 30_000 })
}

export function useBotStats(id: string, days: number) {
  return useQuery({ queryKey: ['bots', id, 'stats', days], queryFn: () => call<BotStats>(`bots/${id}/stats?days=${days}`) })
}

export function useBotTurns(id: string) {
  return useQuery({ queryKey: ['bots', id, 'turns'], queryFn: () => call<BotTurn[]>(`bots/${id}/turns?limit=100`), refetchInterval: 30_000 })
}

export function useSaveBotPolicy(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: BotPolicy) => call<BotPolicy>(`bots/${id}/policy`, { method: 'PUT', body: JSON.stringify(p) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })
}

export function useSaveBotBrands(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: BotBrands) => call<{ restart_ok: boolean }>(`bots/${id}/brands`, { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })
}

export function useSaveBotTelegram(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: { token?: string; enabled?: boolean }) =>
      call<BotTelegram>(`bots/${id}/telegram`, { method: 'PUT', body: JSON.stringify(t) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })
}

export function useBotAction(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => call<{ ok: boolean }>(`bots/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })
}
