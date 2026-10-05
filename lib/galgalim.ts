import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/** One Diego v2 row for a Galgalim request (field names are the agent's Hebrew keys). */
export interface GgRow { no?: string; 'תיאור'?: string; 'מק״ט'?: string; 'הערות'?: string; 'במלאי'?: string; 'מחיר'?: string; 'התאמה'?: string }

export interface GgRequest {
  id: string; date: string; ctype: string; location: string; condition: string[]
  make: string; model: string; trim: string; year: string; fuel: string; cc: string; gear: string
  part: string; plate: string; vin: string; engine: string
  outcome: 'offer' | 'not_stocked' | 'not_found' | 'error' | 'backlog'
  suggestion?: GgRow | null; diego_rows?: GgRow[]; diego_path?: string; diego_reply?: string; diego_s?: number
  card_message_id?: number | null; card_sent_at?: number; error?: string
}

export interface GgStatus { last_run: number | null; last_ok: number | null; last_error: string | null; runs: number; every_s: number; send: boolean; next_run?: number | null }

export function useGalgalim(days: number) {
  return useQuery({
    queryKey: ['galgalim', days],
    queryFn: async () => {
      const r = await fetch(`/api/galgalim/requests?days=${days}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      return j as { items: GgRequest[]; status: GgStatus }
    },
    refetchInterval: 60_000,
  })
}

async function send(path: string, method: 'PUT' | 'POST', body?: unknown) {
  const r = await fetch(`/api/galgalim/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j
}

/** The polling interval, live on the agent (no restart). */
export function useSetGalgalimInterval() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (every_s: number) => send('config', 'PUT', { every_s }), onSuccess: () => qc.invalidateQueries({ queryKey: ['galgalim'] }) })
}

/** Check the trading floor now (the next scheduled check is re-planned from this one). */
export function useRunGalgalim() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => send('run', 'POST'), onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['galgalim'] }), 4000) })
}
