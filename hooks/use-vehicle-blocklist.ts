'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorLines } from '@/lib/vehicle-twins'
import type {
  BlocklistDetailResponse, BlocklistEntry, BlocklistListResponse, BlocklistVinTest,
} from '@/lib/vehicle-blocklist'
import { TwinApiError } from '@/hooks/use-vehicle-twins'

/** Same error type as the twins page, so the shared error list renders Partly's messages. */
export { TwinApiError as BlocklistApiError }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new TwinApiError(res.status, apiErrorLines(res.status, body))
  return body as T
}

const LIST_KEY = ['vehicle-blocklist'] as const

export function useVehicleBlocklist() {
  return useQuery<BlocklistListResponse>({
    queryKey: LIST_KEY,
    queryFn: () => call<BlocklistListResponse>('/api/vehicle-blocklist'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useBlocklistDetail(id: string | null) {
  return useQuery<BlocklistDetailResponse>({
    queryKey: ['vehicle-blocklist-entry', id],
    queryFn: () => call<BlocklistDetailResponse>(`/api/vehicle-blocklist/${encodeURIComponent(String(id))}`),
    enabled: id != null,
    staleTime: 0,
  })
}

export function useBlocklistVinTest() {
  return useMutation<BlocklistVinTest, TwinApiError, string>({
    mutationFn: vin => call<BlocklistVinTest>(`/api/vehicle-blocklist?vin=${encodeURIComponent(vin.trim())}`),
  })
}

export function useSaveBlocklistEntry() {
  const qc = useQueryClient()
  return useMutation<{ entry: BlocklistEntry }, TwinApiError, { id: string | null; payload: Record<string, unknown> }>({
    mutationFn: ({ id, payload }) => id == null
      ? call('/api/vehicle-blocklist', { method: 'POST', body: JSON.stringify(payload) })
      : call(`/api/vehicle-blocklist/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      if (v.id != null) qc.invalidateQueries({ queryKey: ['vehicle-blocklist-entry', v.id] })
    },
  })
}

export function useDeleteBlocklistEntry() {
  const qc = useQueryClient()
  return useMutation<{ deleted: unknown }, TwinApiError, string>({
    mutationFn: id => call(`/api/vehicle-blocklist/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}
