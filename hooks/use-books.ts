'use client'

/**
 * React Query hooks for הנהח״ש.
 *
 * Every list screen sends its filter, sort and page to the server, so the query
 * key is the whole scope — a sorted page is a different query, not a re-sort of
 * the rows already loaded.
 */

import { useQuery } from '@tanstack/react-query'

export interface BooksQuery {
  year: number
  from?: string
  to?: string
  q?: string
  sort?: string
  dir?: string
  page?: number
  [key: string]: string | number | undefined
}

function toSearch(params: BooksQuery): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue
    search.set(key, String(value))
  }
  return search.toString()
}

async function fetchBooks<T>(path: string, params: BooksQuery): Promise<T> {
  const res = await fetch(`/api/books/${path}?${toSearch(params)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || `Failed to load ${path}`)
  return data as T
}

const LIST_OPTIONS = {
  staleTime: 5 * 60 * 1000,
  gcTime: 15 * 60 * 1000,
  retry: 1,
  refetchOnWindowFocus: false,
} as const

function useBooks<T>(key: string, path: string, params: BooksQuery, enabled = true) {
  return useQuery<T>({
    queryKey: [`books:${key}`, params],
    queryFn: () => fetchBooks<T>(path, params),
    enabled,
    ...LIST_OPTIONS,
  })
}

export function useBooksYears() {
  return useQuery({
    queryKey: ['books:years'],
    queryFn: () => fetchBooks<any>('years', {} as BooksQuery),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export const useBooksOverview = (p: BooksQuery) => useBooks<any>('overview', 'overview', p)
export const useBooksAccounts = (p: BooksQuery) => useBooks<any>('accounts', 'accounts', p)
export const useBooksTrialBalance = (p: BooksQuery) =>
  useBooks<any>('trial-balance', 'trial-balance', p)
export const useBooksJournal = (p: BooksQuery) => useBooks<any>('journal', 'journal', p)
export const useBooksVat = (p: BooksQuery) => useBooks<any>('vat', 'vat', p)
export const useBooksCash = (p: BooksQuery) => useBooks<any>('cash', 'cash', p)
export const useBooksCashTable = (p: BooksQuery) => useBooks<any>('cash-tables', 'cash-tables', p)
export const useBooksPurchasing = (p: BooksQuery) => useBooks<any>('purchasing', 'purchasing', p)
export const useBooksSuppliers = (p: BooksQuery) =>
  useBooks<any>('suppliers', 'purchasing/suppliers', p)

export const useLedgerCard = (code: string, p: BooksQuery) =>
  useBooks<any>(`card:${code}`, `accounts/${encodeURIComponent(code)}`, p, Boolean(code))

export const useJournalEntry = (ref: string, year: number) =>
  useBooks<any>(`entry:${ref}`, `journal/${encodeURIComponent(ref)}`, { year }, Boolean(ref))

export const useBooksReceipt = (number: string, year: number) =>
  useBooks<any>(`receipt:${number}`, `cash/${encodeURIComponent(number)}`, { year },
    Boolean(number))

/** The AI reading of the current window. Never runs on its own — the analyse
 *  button turns it on, so opening a page costs nothing. */
export function useBooksInsights(p: BooksQuery, enabled: boolean) {
  return useQuery({
    queryKey: ['books:insights', p],
    queryFn: () => fetchBooks<any>('insights', p),
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
