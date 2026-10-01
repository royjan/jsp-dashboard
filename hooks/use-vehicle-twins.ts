'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  apiErrorLines,
  type MeasureResponse, type TwinDetailResponse, type TwinListResponse, type TwinLookupResponse, type VehicleTwin,
} from '@/lib/vehicle-twins'

/** An API failure that keeps Partly's messages, so the modal can list them. */
export class TwinApiError extends Error {
  constructor(public status: number, public lines: string[]) {
    super(lines.join(' · '))
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new TwinApiError(res.status, apiErrorLines(res.status, body))
  return body as T
}

const LIST_KEY = ['vehicle-twins'] as const

export function useVehicleTwins() {
  return useQuery<TwinListResponse>({
    queryKey: LIST_KEY,
    queryFn: () => call<TwinListResponse>('/api/vehicle-twins'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function useTwinDetail(id: VehicleTwin['id'] | null) {
  return useQuery<TwinDetailResponse>({
    queryKey: ['vehicle-twin', id],
    queryFn: () => call<TwinDetailResponse>(`/api/vehicle-twins/${encodeURIComponent(String(id))}`),
    enabled: id != null,
    staleTime: 0,
  })
}

export function useVinLookup() {
  return useMutation<TwinLookupResponse, TwinApiError, string>({
    mutationFn: vin => call<TwinLookupResponse>(`/api/vehicle-twins?vin=${encodeURIComponent(vin.trim())}`),
  })
}

export function useSaveTwin() {
  const qc = useQueryClient()
  return useMutation<{ twin: VehicleTwin }, TwinApiError, { id: VehicleTwin['id'] | null; payload: Record<string, unknown> }>({
    mutationFn: ({ id, payload }) => id == null
      ? call('/api/vehicle-twins', { method: 'POST', body: JSON.stringify(payload) })
      : call(`/api/vehicle-twins/${encodeURIComponent(String(id))}`, { method: 'PUT', body: JSON.stringify(payload) }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      if (v.id != null) qc.invalidateQueries({ queryKey: ['vehicle-twin', v.id] })
    },
  })
}

export function useDeleteTwin() {
  const qc = useQueryClient()
  return useMutation<{ deleted: unknown }, TwinApiError, VehicleTwin['id']>({
    mutationFn: id => call(`/api/vehicle-twins/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export function useMeasureTwin() {
  const qc = useQueryClient()
  return useMutation<MeasureResponse, TwinApiError, VehicleTwin['id']>({
    mutationFn: id => call(`/api/vehicle-twins/${encodeURIComponent(String(id))}/measure`, { method: 'POST', body: '{}' }),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      qc.invalidateQueries({ queryKey: ['vehicle-twin', id] })
    },
  })
}
