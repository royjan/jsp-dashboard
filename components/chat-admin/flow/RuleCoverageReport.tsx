'use client'

import { useEffect, useState } from 'react'
import { Loader2, Map, TrendingUp, Plus } from 'lucide-react'
import type { FlowDecisionRecord } from '@/types/chat-admin/flow-decision'
import { logger } from '@/lib/logger'

interface CoverageRow {
  description: string
  usageCount: number
  hasRule: boolean
}

interface Props {
  existingRules: FlowDecisionRecord[]
  onSeedRule: (partDescription: string) => void
}

export function RuleCoverageReport({ existingRules, onSeedRule }: Props) {
  const [rows, setRows] = useState<CoverageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showOnlyMissing, setShowOnlyMissing] = useState(true)

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
  }, [existingRules.length])

  const filtered = showOnlyMissing ? rows.filter(r => !r.hasRule) : rows
  const missingCount = rows.filter(r => !r.hasRule).length
  const total = rows.length

  return (
    <div className="h-full overflow-y-auto px-6 pb-32 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <Map className="h-5 w-5 text-indigo-500" />
            Coverage report
          </h2>
          <p className="text-sm text-slate-500">
            {total} part descriptions tracked · <span className="text-amber-600">{missingCount} have no rule</span>
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showOnlyMissing}
            onChange={e => setShowOnlyMissing(e.target.checked)}
            className="rounded border-slate-300"
          />
          Show only uncovered
        </label>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading coverage...
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">
          {showOnlyMissing ? 'Every tracked part description has at least one rule.' : 'No part descriptions tracked yet.'}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="min-w-[520px] w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Part description</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Usage</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Has rule</th>
                <th className="w-32 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map(row => (
                <tr key={row.description} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-100">{row.description}</td>
                  <td className="px-3 py-2 text-right text-sm text-slate-700 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 text-slate-400" />
                      {row.usageCount}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${row.hasRule ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!row.hasRule && (
                      <button
                        onClick={() => onSeedRule(row.description)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Plus className="h-3 w-3" />
                        Create rule
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
