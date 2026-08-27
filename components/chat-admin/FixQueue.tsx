'use client'

import React, { useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import { StatusBadge } from './shared'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

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

function pinHref(query: string) {
  return `/chat/flow-decisions?source=learned&q=${encodeURIComponent(query)}`
}

const COLUMNS: DataTableColumn<FixRow>[] = [
  {
    key: 'query',
    header: 'Query',
    sortable: true,
    truncate: 'max-w-[280px]',
    title: r => r.query,
    cell: r => {
      // A schema key is an identifier, not prose — forcing it LTR keeps the
      // punctuation at the end where it belongs. The user queries are Hebrew.
      const isLtr = r.problem === 'schema'
      return (
        <div>
          <div dir={isLtr ? 'ltr' : 'rtl'} className={`truncate ${isLtr ? 'font-mono text-xs' : ''}`}>
            {r.query || '(empty)'}
          </div>
          {r.normalized && r.problem !== 'schema' && (
            <div dir="ltr" className="truncate font-mono text-[11px] text-muted-foreground">
              {r.normalized}
            </div>
          )}
        </div>
      )
    },
    exportValue: r => r.query,
  },
  {
    key: 'problem',
    header: 'Problem',
    sortable: true,
    cell: r => <StatusBadge status={PROBLEM_META[r.problem].status} label={PROBLEM_META[r.problem].label} size="sm" />,
    exportValue: r => PROBLEM_META[r.problem].label,
  },
  {
    key: 'count',
    header: 'Hits',
    align: 'end',
    sortable: true,
    cell: r => r.count.toLocaleString(),
    exportValue: r => r.count,
  },
  {
    key: 'action',
    header: 'Suggested action',
    hideOnMobile: true,
    cell: r => <span className="text-xs text-muted-foreground">{PROBLEM_META[r.problem].action}</span>,
    exportValue: r => PROBLEM_META[r.problem].action,
  },
  {
    key: 'actions',
    header: '',
    align: 'end',
    cell: r => (
      <span className="inline-flex items-center gap-1.5">
        {/* real conversations where this query failed — judge extraction vs routing vs catalog */}
        <Link
          href={`/chat/diego?q=${encodeURIComponent(r.query)}`}
          title="View example sessions with this query"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <MessagesSquare className="h-3.5 w-3.5" /> Examples
        </Link>
        <Link
          href={pinHref(r.query)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          Fix <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </span>
    ),
    exportValue: null,
  },
]

/** Merged, ranked action list across not-found / OOS / schema-flip problems. */
export function FixQueue({ notFound, oos, schemaFlips }: FixQueueProps) {
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

  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      // The list is a merge of three sources, so index is the only stable key —
      // the same query can legitimately appear as both not-found and OOS.
      getRowKey={(r, i) => `${r.problem}:${r.query}:${i}`}
      // No defaultSort on purpose: the incoming order IS the ranking (weighted
      // so a schema flip sits below an equal-count hard failure), and handing
      // the table a sort field would silently discard that weighting.
      pageSize={15}
      minWidth="min-w-[720px]"
      exportFileName="fix-queue"
      labels={{ empty: '🎉 Nothing to fix this period.' }}
      mobileCard={{
        title: r => r.query || '(empty)',
        subtitle: r => PROBLEM_META[r.problem].action,
        accent: r => r.count.toLocaleString(),
      }}
    />
  )
}

export default FixQueue
