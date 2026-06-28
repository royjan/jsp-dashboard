'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Pin, Trash2, Globe, Crosshair, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react'

interface LearnedPin {
  id: string
  partDescription: string
  nav: { category?: string; subcategory?: string; schema?: string }
  lambdaTarget: string
  scope: { model?: string; engine?: string; yearFrom?: number; yearTo?: number } | null
  source: string
  status: string
  confidence: number | null
  feedbackCount: number | null
  createdAt: string
  createdBy: string | null
  pinnedPart: { partId: string; name: string; price: number | null; currency: string; inStock: boolean } | null
}

const SOURCE_LABEL: Record<string, string> = {
  schema_ref_correction: 'agent correction',
  agent_correction_seed: 'seed',
  chat_correction: 'chat',
}
const SOURCE_KEYS = ['schema_ref_correction', 'agent_correction_seed', 'chat_correction']

type SortKey = 'term' | 'source' | 'created'
type SortDir = 'asc' | 'desc'

function relativeDays(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const days = Math.floor((Date.now() - d) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default function LearnedPinsTab() {
  const [items, setItems] = useState<LearnedPin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // filters / sort — seed `term` from the ?prefill= the dashboard "Fix/Pin" links pass
  const _sp = useSearchParams()
  const [term, setTerm] = useState(_sp?.get('prefill') ?? '')
  const [sourceFilter, setSourceFilter] = useState('')
  const [oosOnly, setOosOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const load = () => {
    setLoading(true); setError(null)
    fetch('/api/admin/learned-pins')
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || r.status)))
      .then(j => setItems(j.items || []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const undo = async (p: LearnedPin) => {
    if (!confirm(`Undo learned pin?\n\n"${p.partDescription}" → ${p.pinnedPart?.partId || '(no part)'}\nThis deletes the flow decision + its pinned part.`)) return
    setBusy(p.id)
    try {
      const r = await fetch(`/api/admin/learned-pins?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || r.status)
      setItems(prev => prev.filter(x => x.id !== p.id))
    } catch (e) { alert('Undo failed: ' + e) } finally { setBusy(null) }
  }

  const oosCount = useMemo(() => items.filter(p => p.pinnedPart && !p.pinnedPart.inStock).length, [items])
  const sourceCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of items) m[p.source] = (m[p.source] || 0) + 1
    return m
  }, [items])

  const visible = useMemo(() => {
    let rows = items
    if (term.trim()) {
      const q = term.trim().toLowerCase()
      rows = rows.filter(p => (p.partDescription || '').toLowerCase().includes(q))
    }
    if (sourceFilter) rows = rows.filter(p => p.source === sourceFilter)
    if (oosOnly) rows = rows.filter(p => p.pinnedPart && !p.pinnedPart.inStock)
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'term') cmp = (a.partDescription || '').localeCompare(b.partDescription || '')
      else if (sortKey === 'source') cmp = (a.source || '').localeCompare(b.source || '')
      else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      return cmp * dir
    })
  }, [items, term, sourceFilter, oosOnly, sortKey, sortDir])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'created' ? 'desc' : 'asc') }
  }
  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null
    return sortDir === 'asc' ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-tertiary,#8a8a90)]">
        Flow decisions created by the learning loop (agent corrections / seeds). Each pins a specific part for a search term.
        Use <b>Undo</b> to remove a wrong one — it only affects learned rows, never hand-curated rules.
      </p>

      {/* counts row */}
      {!loading && !error && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] px-2 py-1 text-[var(--color-text-secondary,#c7c7cc)]">
            {items.length} pins
          </span>
          {SOURCE_KEYS.filter(s => sourceCounts[s]).map(s => (
            <span key={s} className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] px-2 py-1 text-[var(--color-text-secondary,#c7c7cc)]">
              {SOURCE_LABEL[s]}: {sourceCounts[s]}
            </span>
          ))}
          {oosCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">
              <AlertTriangle className="h-3 w-3" /> OOS pins: {oosCount}
            </span>
          )}
        </div>
      )}

      {/* filter bar */}
      {!loading && !error && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input dir="rtl" value={term} onChange={e => setTerm(e.target.value)} placeholder="חיפוש מונח…"
            className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] px-2 py-1 text-sm text-[var(--color-text-primary,#e7e7ea)] focus:outline-none" />
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
            className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] px-2 py-1 text-sm text-[var(--color-text-secondary,#c7c7cc)] focus:outline-none">
            <option value="">All sources</option>
            {SOURCE_KEYS.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary,#c7c7cc)]">
            <input type="checkbox" checked={oosOnly} onChange={e => setOosOnly(e.target.checked)} />
            OOS pins only
          </label>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">Error: {error}</div>}
      {loading ? (
        <div className="text-sm text-[var(--color-text-tertiary,#8a8a90)]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[var(--color-text-tertiary,#8a8a90)]">No learned pins yet.</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-[var(--color-text-tertiary,#8a8a90)]">No pins match the current filters.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border-default)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-bg-elevated,#1b1b1f)] text-[var(--color-text-tertiary,#8a8a90)]">
              <tr className="text-left">
                <th className="cursor-pointer px-3 py-2 font-medium select-none" onClick={() => toggleSort('term')}>Term <SortIcon k="term" /></th>
                <th className="px-3 py-2 font-medium">Pinned part</th>
                <th className="px-3 py-2 font-medium">Schema (nav)</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="cursor-pointer px-3 py-2 font-medium select-none" onClick={() => toggleSort('source')}>Source / status <SortIcon k="source" /></th>
                <th className="cursor-pointer px-3 py-2 font-medium select-none" onClick={() => toggleSort('created')}>Created <SortIcon k="created" /></th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const oos = p.pinnedPart && !p.pinnedPart.inStock
                return (
                  <tr key={p.id} className={`border-t border-[var(--color-border-default)] hover:bg-white/5 ${oos ? 'border-l-2 border-l-amber-400/60' : ''}`}>
                    <td className="px-3 py-2 font-medium text-[var(--color-text-primary,#e7e7ea)]" dir="rtl">{p.partDescription}</td>
                    <td className="px-3 py-2">
                      {p.pinnedPart ? (
                        <div className="flex items-center gap-1.5">
                          {oos
                            ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            : <Pin className="h-3.5 w-3.5 text-blue-400" />}
                          <span dir="ltr" className="font-mono text-xs">{p.pinnedPart.partId}</span>
                          <span className="max-w-[180px] truncate text-[var(--color-text-tertiary,#8a8a90)]">{p.pinnedPart.name}</span>
                          <span className={`text-xs ${p.pinnedPart.inStock ? 'text-green-400' : 'text-amber-400'}`}>
                            {p.pinnedPart.inStock ? 'in stock' : 'OOS'}
                          </span>
                        </div>
                      ) : <span className="text-[var(--color-text-tertiary,#8a8a90)]">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-secondary,#c7c7cc)]">
                      <span dir="ltr" className="font-mono">{[p.nav.category, p.nav.subcategory, p.nav.schema].filter(Boolean).join(' / ')}</span>
                      <span className="ml-2 text-[var(--color-text-tertiary,#8a8a90)]">[{p.lambdaTarget}]</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.scope ? (
                        <span className="inline-flex items-center gap-1 text-amber-300"><Crosshair className="h-3 w-3" />
                          {[p.scope.model, p.scope.engine, p.scope.yearFrom].filter(Boolean).join(' · ')}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[var(--color-text-tertiary,#8a8a90)]"><Globe className="h-3 w-3" /> generic</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="text-[var(--color-text-secondary,#c7c7cc)]">{SOURCE_LABEL[p.source] || p.source}</span>
                      <span className="ml-2 text-[var(--color-text-tertiary,#8a8a90)]">{p.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-tertiary,#8a8a90)]">
                      {relativeDays(p.createdAt)}
                      {p.createdBy && <span className="ml-1 opacity-70">· {p.createdBy}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => undo(p)} disabled={busy === p.id}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" /> {busy === p.id ? '…' : 'Undo'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
