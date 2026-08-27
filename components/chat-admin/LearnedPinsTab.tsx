'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Pin, Trash2, Globe, Crosshair, AlertTriangle } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

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

function relativeDays(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const days = Math.floor((Date.now() - d) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}


/** Built in the component: the Undo cell needs `undo` and the in-flight row id. */
function buildColumns(
  undo: (p: LearnedPin) => void,
  busy: string | null,
): DataTableColumn<LearnedPin>[] {
  return [
    {
      key: 'term',
      header: 'Term',
      sortable: true,
      sortValue: p => p.partDescription || '',
      truncate: 'max-w-[220px]',
      title: p => p.partDescription,
      cell: p => <span className="font-medium" dir="rtl">{p.partDescription}</span>,
      exportValue: p => p.partDescription,
    },
    {
      key: 'pinnedPart',
      header: 'Pinned part',
      cell: p => {
        if (!p.pinnedPart) return <span className="text-muted-foreground">—</span>
        const oos = !p.pinnedPart.inStock
        return (
          <div className="flex items-center gap-1.5">
            {oos ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> : <Pin className="h-3.5 w-3.5 text-blue-400" />}
            <span dir="ltr" className="font-mono text-xs">{p.pinnedPart.partId}</span>
            <span className="max-w-[180px] truncate text-muted-foreground">{p.pinnedPart.name}</span>
            <span className={`text-xs ${p.pinnedPart.inStock ? 'text-green-500' : 'text-amber-500'}`}>
              {p.pinnedPart.inStock ? 'in stock' : 'OOS'}
            </span>
          </div>
        )
      },
      exportValue: p => (p.pinnedPart ? `${p.pinnedPart.partId} ${p.pinnedPart.name}` : ''),
    },
    {
      key: 'nav',
      header: 'Schema (nav)',
      hideOnMobile: true,
      cell: p => (
        <span className="text-xs text-muted-foreground">
          <span dir="ltr" className="font-mono">
            {[p.nav.category, p.nav.subcategory, p.nav.schema].filter(Boolean).join(' / ')}
          </span>
          <span className="ms-2 opacity-70">[{p.lambdaTarget}]</span>
        </span>
      ),
      exportValue: p => [p.nav.category, p.nav.subcategory, p.nav.schema].filter(Boolean).join(' / '),
    },
    {
      key: 'scope',
      header: 'Scope',
      hideOnMobile: true,
      cell: p =>
        p.scope ? (
          <span className="inline-flex items-center gap-1 text-xs text-amber-500">
            <Crosshair className="h-3 w-3" />
            {[p.scope.model, p.scope.engine, p.scope.yearFrom].filter(Boolean).join(' · ')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="h-3 w-3" /> generic
          </span>
        ),
      exportValue: p =>
        p.scope ? [p.scope.model, p.scope.engine, p.scope.yearFrom].filter(Boolean).join(' · ') : 'generic',
    },
    {
      key: 'source',
      header: 'Source / status',
      sortable: true,
      sortValue: p => p.source || '',
      cell: p => (
        <span className="text-xs">
          <span>{SOURCE_LABEL[p.source] || p.source}</span>
          <span className="ms-2 text-muted-foreground">{p.status}</span>
        </span>
      ),
      exportValue: p => `${SOURCE_LABEL[p.source] || p.source} / ${p.status}`,
    },
    {
      key: 'created',
      header: 'Created',
      sortable: true,
      // Sort on the timestamp, not on the rendered "3 days ago" — that string
      // sorts "10 days ago" before "2 days ago".
      sortValue: p => new Date(p.createdAt).getTime(),
      cell: p => (
        <span className="text-xs text-muted-foreground">
          {relativeDays(p.createdAt)}
          {p.createdBy && <span className="ms-1 opacity-70">· {p.createdBy}</span>}
        </span>
      ),
      exportValue: p => p.createdAt,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: p => (
        <button
          onClick={() => undo(p)}
          disabled={busy === p.id}
          className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> {busy === p.id ? '…' : 'Undo'}
        </button>
      ),
      exportValue: null,
    },
  ]
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
    return rows
  }, [items, term, sourceFilter, oosOnly])

  const columns = useMemo(() => buildColumns(undo, busy), [busy])

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

      <DataTable
        rows={visible}
        columns={columns}
        getRowKey={p => p.id}
        loading={loading}
        error={error ?? undefined}
        onRetry={load}
        defaultSort={{ field: 'created', dir: 'desc' }}
        pageSize={25}
        minWidth="min-w-[900px]"
        exportFileName="learned-pins"
        // An out-of-stock pin is the actionable row on this screen, so it keeps
        // its marker rather than blending into the rest.
        rowClassName={p => (p.pinnedPart && !p.pinnedPart.inStock ? 'border-s-2 border-s-amber-400/60' : undefined)}
        labels={{
          empty: items.length === 0 ? 'No learned pins yet.' : 'No pins match the current filters.',
        }}
        mobileCard={{
          title: p => p.partDescription,
          subtitle: p => p.pinnedPart?.partId ?? '—',
          accent: p => (p.pinnedPart && !p.pinnedPart.inStock ? 'OOS' : ''),
          fields: [
            { label: 'Source', value: p => SOURCE_LABEL[p.source] || p.source },
            { label: 'Created', value: p => relativeDays(p.createdAt) },
          ],
        }}
      />
    </div>
  )
}
