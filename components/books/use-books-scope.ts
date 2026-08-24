'use client'

/**
 * The filter state every bookkeeping screen shares, kept in the URL.
 *
 * One place decides the defaults — 1 January of the selected year through
 * today — and defaults are written back as `null` so a clean view has a clean
 * URL. Sorting and paging live here too, because the server does both: a page
 * of rows is already the sorted, filtered answer.
 */

import { useCallback, useMemo } from 'react'
import { useUrlParams } from '@/hooks/use-url-params'
import { useBooksYears } from '@/hooks/use-books'

export interface BooksScopeState {
  year: number
  liveYear: number
  from: string
  to: string
  q: string
  sort: string
  dir: 'asc' | 'desc'
  page: number
  isLive: boolean
  /** True when the live year's data has not been refreshed in hours. */
  stale: boolean
  years: Array<{ year: number; state: string; refreshed_at: string | null; stale?: boolean }>
  loading: boolean
  /** The scope as query parameters, for the data hooks. */
  params: Record<string, string | number | undefined>
  /** Raw read of any URL param — for the ad-hoc ones (view, kind, class, …)
   *  that `params` doesn't carry, since a page's own filter belongs in its
   *  own URL key, not in the shared scope shape. */
  get: (key: string) => string | null
  set: (updates: Record<string, string | number | null | undefined>) => void
  setYear: (year: number) => void
  setSort: (field: string) => void
  reset: () => void
}

export function defaultWindow(year: number, live: number) {
  const from = `${year}-01-01`
  if (year !== live) return { from, to: `${year}-12-31` }
  const now = new Date()
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 10)
  return { from, to: today }
}

export function useBooksScope(defaultSort = ''): BooksScopeState {
  const { get, setMany } = useUrlParams()
  const { data, isLoading } = useBooksYears()

  const years = data?.years ?? []
  const liveYear = years.find((y: any) => y.state === 'live')?.year
    ?? years[0]?.year ?? new Date().getFullYear()
  const year = Number(get('year')) || liveYear
  const window = defaultWindow(year, liveYear)
  const from = get('from') || window.from
  const to = get('to') || window.to
  const q = get('q') ?? ''
  const sort = get('sort') || defaultSort
  const dir = get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(get('page')) || 1)
  const yearRow = years.find((y: any) => y.year === year)

  const set = useCallback((updates: Record<string, string | number | null | undefined>) => {
    const next: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(updates)) {
      next[key] = value === null || value === undefined || value === '' ? undefined : String(value)
    }
    setMany(next)
  }, [setMany])

  const setYear = useCallback((nextYear: number) => {
    // A new year re-defaults the window: last year's dates would filter the
    // new one down to nothing.
    const w = defaultWindow(nextYear, liveYear)
    setMany({
      year: nextYear === liveYear ? undefined : String(nextYear),
      from: undefined, to: undefined, page: undefined,
      ...(nextYear === liveYear ? {} : { from: w.from, to: w.to }),
    })
  }, [liveYear, setMany])

  const setSort = useCallback((field: string) => {
    // Clicking the active column flips it; a new column starts descending.
    const nextDir = sort === field && dir === 'desc' ? 'asc' : 'desc'
    setMany({
      sort: field === defaultSort && nextDir === 'desc' ? undefined : field,
      dir: nextDir === 'desc' ? undefined : nextDir,
      page: undefined,
    })
  }, [sort, dir, defaultSort, setMany])

  const reset = useCallback(() => {
    setMany({ q: undefined, from: undefined, to: undefined, page: undefined })
  }, [setMany])

  const params = useMemo(() => ({
    year,
    from: from === window.from ? undefined : from,
    to: to === window.to ? undefined : to,
    q: q || undefined,
    sort: sort || undefined,
    dir: dir === 'desc' ? undefined : dir,
    page: page > 1 ? page : undefined,
  }), [year, from, to, q, sort, dir, page, window.from, window.to])

  return {
    year, liveYear, from, to, q, sort, dir, page,
    isLive: year === liveYear,
    stale: Boolean(yearRow?.stale),
    years, loading: isLoading, params, get,
    set, setYear, setSort, reset,
  }
}
