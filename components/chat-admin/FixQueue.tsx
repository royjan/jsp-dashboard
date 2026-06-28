'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AdminPagination, StatusBadge } from './shared'

export interface FixRow {
  query: string
  normalized?: string
  problem: 'notfound' | 'oos' | 'schema'
  count: number
  portal?: string
  n?: number
}

interface FixQueueProps {
  notFound: Array<{ query: string; count: number }>
  oos: Array<{ query: string; count: number }>
  schemaFlips: Array<{ query: string; schemas: string[]; n: number }>
}

const PROBLEM_META: Record<FixRow['problem'], { status: string; label: string; action: string }> = {
  notfound: { status: 'error', label: 'Not found', action: 'Add flow decision' },
  oos: { status: 'warning', label: 'Out of stock', action: 'Check stock / source alt.' },
  schema: { status: 'unknown', label: 'Schema flip', action: 'Pin schema' },
}

const PAGE_SIZE = 15

function pinHref(query: string) {
  return `/admin/learned-pins?prefill=${encodeURIComponent(query)}`
}

/** Merged, ranked action list across not-found / OOS / schema-flip problems. */
export function FixQueue({ notFound, oos, schemaFlips }: FixQueueProps) {
  const [page, setPage] = useState(1)

  const rows: FixRow[] = useMemo(() => {
    const merged: FixRow[] = [
      ...notFound.map(r => ({ query: r.query, problem: 'notfound' as const, count: r.count })),
      ...oos.map(r => ({ query: r.query, problem: 'oos' as const, count: r.count })),
      ...schemaFlips.map(r => ({ query: r.query, normalized: r.query, problem: 'schema' as const, count: r.n, n: r.n })),
    ]
    // schema flips ranked slightly lower than equal-count hard failures
    return merged.sort((a, b) => {
      const wa = a.problem === 'schema' ? a.count * 0.8 : a.count
      const wb = b.problem === 'schema' ? b.count * 0.8 : b.count
      return wb - wa
    })
  }, [notFound, oos, schemaFlips])

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[var(--color-text-secondary,#c7c7cc)]">
        🎉 Nothing to fix this period.
      </div>
    )
  }

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
        <table className="w-full text-sm">
          <thead className="bg-black/20 text-[var(--color-text-tertiary,#8a8a90)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Query</th>
              <th className="px-3 py-2 font-medium">Problem</th>
              <th className="px-3 py-2 text-right font-medium">Hits</th>
              <th className="px-3 py-2 font-medium">Suggested action</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const meta = PROBLEM_META[r.problem]
              const isLtr = r.problem === 'schema'
              return (
                <tr key={i} className="border-t border-[var(--color-border-default)] hover:bg-white/5">
                  <td className="px-3 py-2 max-w-[280px]">
                    <div
                      dir={isLtr ? 'ltr' : 'rtl'}
                      title={r.query}
                      className={`truncate text-[var(--color-text-primary,#e7e7ea)] ${isLtr ? 'font-mono text-xs' : ''}`}
                    >
                      {r.query || '(empty)'}
                    </div>
                    {r.normalized && r.problem !== 'schema' && (
                      <div dir="ltr" className="truncate font-mono text-[11px] text-[var(--color-text-tertiary,#8a8a90)]">{r.normalized}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={meta.status} label={meta.label} size="sm" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary,#c7c7cc)]">{r.count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-secondary,#c7c7cc)]">{meta.action}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={pinHref(r.query)}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-xs text-[var(--color-text-secondary,#c7c7cc)] hover:bg-white/5"
                    >
                      Fix <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <AdminPagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}

export default FixQueue
