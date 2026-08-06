'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CompetitorCompareResponse } from '@/app/api/analytics/competitors/route'

export class DuplicateUploadError extends Error {
  existingUploadId: string
  uploadedAt: string | null
  constructor(message: string, existingUploadId: string, uploadedAt: string | null) {
    super(message)
    this.name = 'DuplicateUploadError'
    this.existingUploadId = existingUploadId
    this.uploadedAt = uploadedAt
  }
}

/**
 * Filtering, sorting and paging all happen server-side, so the query key is the
 * query string — each distinct view is its own cache entry and only one page of
 * rows crosses the wire. `placeholderData` keeps the previous page on screen
 * while the next one loads, so paging doesn't flash the skeleton.
 */
export function useCompetitorComparison(params: string) {
  return useQuery<CompetitorCompareResponse>({
    queryKey: ['competitors-compare', params],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/competitors${params ? `?${params}` : ''}`)
      if (!res.ok) throw new Error('Failed to fetch competitor comparison')
      return res.json()
    },
    placeholderData: previous => previous,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
}

export function useCompetitorUploads() {
  return useQuery({
    queryKey: ['competitor-uploads'],
    queryFn: async () => {
      const res = await fetch('/api/competitors/upload')
      if (!res.ok) throw new Error('Failed to fetch uploads')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
    retry: 2,
  })
}

export function useUploadCompetitorFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, force }: { file: File; force?: boolean }) => {
      const formData = new FormData()
      formData.append('file', file)
      if (force) formData.append('force', 'true')
      const res = await fetch('/api/competitors/upload', { method: 'POST', body: formData })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) {
        throw new DuplicateUploadError(body.error || 'Duplicate file', body.existingUploadId, body.uploadedAt ?? null)
      }
      if (!res.ok) throw new Error(body.error || 'Failed to upload file')
      return body
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitor-uploads'] })
      qc.invalidateQueries({ queryKey: ['competitors-compare'] })
    },
  })
}

export function useCompetitorItemHistory(codes: string[] | null) {
  const param = codes?.length ? codes.join(',') : ''
  return useQuery({
    queryKey: ['competitor-item-history', param],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/competitors/history?codes=${encodeURIComponent(param)}`)
      if (!res.ok) throw new Error('Failed to fetch item history')
      return res.json()
    },
    enabled: !!param,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}
