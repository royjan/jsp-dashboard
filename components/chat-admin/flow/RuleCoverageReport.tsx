'use client'

import { useEffect, useMemo, useState } from 'react'
import { Map, TrendingUp, Plus } from 'lucide-react'
import type { FlowDecisionRecord } from '@/types/chat-admin/flow-decision'
import { logger } from '@/lib/logger'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

interface CoverageRow {
  description: string
  usageCount: number
  hasRule: boolean
}

interface Props {
  existingRules: FlowDecisionRecord[]
  onSeedRule: (partDescription: string) => void
}


/** Built inside the component: the "צור כלל" cell needs the onSeedRule callback. */
function buildColumns(onSeedRule: (d: string) => void): DataTableColumn<CoverageRow>[] {
  return [
    {
      key: 'description',
      header: 'תיאור החלק',
      sortable: true,
      truncate: 'max-w-[320px]',
      title: r => r.description,
      cell: r => <span className="font-medium" dir="auto">{r.description}</span>,
      exportValue: r => r.description,
    },
    {
      key: 'usageCount',
      header: 'שימוש',
      align: 'end',
      sortable: true,
      cell: r => (
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-muted-foreground" />
          {r.usageCount}
        </span>
      ),
      exportValue: r => r.usageCount,
    },
    {
      key: 'hasRule',
      header: 'יש כלל',
      align: 'center',
      sortable: true,
      // Sorted so the uncovered descriptions — the ones this report exists to
      // surface — come first on the ascending click, not last.
      sortValue: r => (r.hasRule ? 1 : 0),
      cell: r => (
        <span
          title={r.hasRule ? 'Covered by at least one rule' : 'No rule'}
          className={`inline-block h-2 w-2 rounded-full ${r.hasRule ? 'bg-emerald-500' : 'bg-amber-400'}`}
        />
      ),
      exportValue: r => (r.hasRule ? 'yes' : 'no'),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: r =>
        r.hasRule ? null : (
          <button
            onClick={() => onSeedRule(r.description)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" />
            צור כלל
          </button>
        ),
      exportValue: null,
    },
  ]
}

export function RuleCoverageReport({ existingRules, onSeedRule }: Props) {
  const [rows, setRows] = useState<CoverageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showOnlyMissing, setShowOnlyMissing] = useState(true)
  // Bumped by the table's retry button so the effect below re-runs.
  const [reloadKey, setReloadKey] = useState(0)

  const columns = useMemo(() => buildColumns(onSeedRule), [onSeedRule])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/flow-decisions/coverage')
      .then(async r => {
        if (!r.ok) throw new Error('Coverage API failed')
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setRows(data.descriptions || [])
      })
      .catch(e => {
        if (cancelled) return
        logger.error('Coverage fetch failed:', e)
        setError(e instanceof Error ? e.message : 'Failed to fetch coverage')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [existingRules.length, reloadKey])

  const filtered = showOnlyMissing ? rows.filter(r => !r.hasRule) : rows
  const missingCount = rows.filter(r => !r.hasRule).length
  const total = rows.length

  return (
    <div className="h-full overflow-y-auto px-6 pb-32 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <Map className="h-5 w-5 text-indigo-500" />
            דוח כיסוי
          </h2>
          <p className="text-sm text-slate-500">
            {total} תיאורי חלקים במעקב · <span className="text-amber-600">{missingCount} ללא כלל</span>
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showOnlyMissing}
            onChange={e => setShowOnlyMissing(e.target.checked)}
            className="rounded border-slate-300"
          />
          הצג רק ללא כלל
        </label>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={r => r.description}
        loading={loading}
        error={error ?? undefined}
        onRetry={() => setReloadKey(k => k + 1)}
        defaultSort={{ field: 'usageCount', dir: 'desc' }}
        pageSize={25}
        minWidth="min-w-[520px]"
        exportFileName="rule-coverage"
        labels={{
          empty: showOnlyMissing
            ? 'Every tracked part description has at least one rule.'
            : 'No תיאורי חלקים במעקב yet.',
        }}
        mobileCard={{
          title: r => r.description,
          subtitle: r => (r.hasRule ? 'Covered' : 'No rule'),
          accent: r => r.usageCount,
        }}
      />

    </div>
  )
}
