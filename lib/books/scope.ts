/**
 * Turning a request's query string into a books scope.
 *
 * One place decides the defaults, so every screen agrees: the window is
 * 1 January of the selected year through today, and a closed year runs to its
 * own year-end because "today" is not in it.
 */

import type { BooksScope } from '@/lib/services/books-service'

export function defaultWindow(year: number, live: number): { from: string; to: string } {
  const from = `${year}-01-01`
  if (year !== live) return { from, to: `${year}-12-31` }
  const today = new Date()
  const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 10)
  return { from, to: iso }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseScope(url: URL, live: number): BooksScope & { extras: URLSearchParams } {
  const p = url.searchParams
  const year = Number(p.get('year')) || live
  const window = defaultWindow(year, live)
  const from = p.get('from')
  const to = p.get('to')
  return {
    year,
    from: from && ISO_DATE.test(from) ? from : window.from,
    to: to && ISO_DATE.test(to) ? to : window.to,
    q: p.get('q')?.trim() || undefined,
    sort: p.get('sort') || undefined,
    dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Number(p.get('page')) || 1,
    pageSize: Number(p.get('pageSize')) || undefined,
    extras: p,
  }
}

/** The uniform failure shape: an error the UI can show, plus empty collections
 *  so a table renders its empty state instead of crashing. */
export function booksError(e: unknown, extra: Record<string, unknown> = {}) {
  console.error('[books] Error:', e)
  return {
    error: e instanceof Error ? e.message : 'Failed to read the books',
    rows: [],
    total: 0,
    ...extra,
  }
}
