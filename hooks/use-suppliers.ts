'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Supplier list ──

export function useSuppliers(search?: string) {
  const q = search?.trim() || ''
  return useQuery({
    queryKey: ['suppliers', q],
    queryFn: async () => {
      const url = q ? `/api/suppliers?q=${encodeURIComponent(q)}` : '/api/suppliers'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch suppliers')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

// ── Create / update supplier ──

export function useCreateSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save supplier')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })
}

// ── Supplier detail ──

export function useSupplierDetail(code: string) {
  return useQuery({
    queryKey: ['supplier', code],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${code}`)
      if (!res.ok) throw new Error('Failed to fetch supplier')
      return res.json()
    },
    enabled: !!code,
    staleTime: 2 * 60 * 1000,
    retry: 2,
  })
}

export function useUpdateSupplier(code: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await fetch(`/api/suppliers/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update supplier')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier', code] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })
}

// ── Supplier orders ──

export function useSupplierOrders(code: string) {
  return useQuery({
    queryKey: ['supplier-orders', code],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${code}/orders`)
      if (!res.ok) throw new Error('Failed to fetch orders')
      return res.json()
    },
    enabled: !!code,
    staleTime: 2 * 60 * 1000,
    retry: 2,
  })
}

export function useConfirmOrder(code: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { documentNumber: string; estimatedDelivery: string; notes?: string }) => {
      const res = await fetch(`/api/suppliers/${code}/orders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to confirm order')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-orders', code] })
      qc.invalidateQueries({ queryKey: ['supplier', code] })
    },
  })
}

// ── Demand forecast ──

export function useSupplierDemand(code: string) {
  return useQuery({
    queryKey: ['supplier-demand', code],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${code}/demand`)
      if (!res.ok) throw new Error('Failed to fetch demand')
      return res.json()
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

// ── Price uploads ──

export function usePriceUploads(code?: string) {
  return useQuery({
    queryKey: ['price-uploads', code],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (code) params.set('supplier_code', code)
      const res = await fetch(`/api/suppliers/price-upload?${params}`)
      if (!res.ok) throw new Error('Failed to fetch uploads')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
    retry: 2,
  })
}

export function useUploadPriceList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch('/api/suppliers/price-upload', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error('Failed to upload price list')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-uploads'] })
    },
  })
}
