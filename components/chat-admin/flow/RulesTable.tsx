'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Car, Package, Loader2, Zap, Activity, Check, X, Pencil, Copy,
} from 'lucide-react'
import type { FlowDecisionRecord, FlowDecisionStatus } from '@/types/chat-admin/flow-decision'
import { toast } from '@/lib/toast'
import { copyText } from '@/lib/chat-admin/clipboard'

type SortKey = 'partDescription' | 'lambdaTarget' | 'status' | 'updatedAt' | 'category' | 'feedbackCount'
type SortDir = 'asc' | 'desc'
const PAGE_SIZES = [25, 50, 100, 200]

interface Props {
  rules: FlowDecisionRecord[]
  loading: boolean
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  onRowClick: (id: string) => void
  onSetStatus?: (id: string, status: FlowDecisionStatus) => void
  activeId?: string | null
}

export function RulesTable({ rules, loading, selectedIds, onSelectionChange, onRowClick, onSetStatus, activeId }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const sorted = useMemo(() => {
    const out = [...rules]
    out.sort((a, b) => {
      const av = (a as any)[sortKey] ?? ''
      const bv = (b as any)[sortKey] ?? ''
      if (av === bv) return 0
      const sign = sortDir === 'asc' ? 1 : -1
      return av > bv ? sign : -sign
    })
    return out
  }, [rules, sortKey, sortDir])

  // Reset to page 1 whenever the result set, sort, or page size changes.
  useEffect(() => { setPage(1) }, [rules, sortKey, sortDir, pageSize])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const clampedPage = Math.min(page, pageCount)
  const start = (clampedPage - 1) * pageSize
  const visible = sorted.slice(start, start + pageSize)

  const allSelected = sorted.length > 0 && sorted.every(r => selectedIds.includes(r.id))
  const someSelected = sorted.some(r => selectedIds.includes(r.id))

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange(selectedIds.filter(id => !sorted.some(r => r.id === id)))
    } else {
      const merged = new Set([...selectedIds, ...sorted.map(r => r.id)])
      onSelectionChange([...merged])
    }
  }

  const toggleOne = (id: string) => {
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (loading && rules.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
        Loading rules...
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
        <Package className="mb-3 h-10 w-10 text-muted-foreground/60" />
        <p className="font-medium text-foreground">No rules match these filters</p>
        <p className="text-sm text-muted-foreground">Adjust filters or create a new rule.</p>
      </div>
    )
  }

  return (
    <div dir="ltr">
      {/* scroll area — bounded height so the header can stick while you scroll rows */}
      <div className="max-h-[calc(100vh-320px)] min-h-[240px] overflow-auto rounded-t-xl border border-white/10 bg-white/[0.03] shadow-lg shadow-black/20 backdrop-blur">
        <table className="w-full table-fixed divide-y divide-white/10 min-w-[860px]">
          <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
            <tr>
              <th className="w-10 px-3 py-2.5 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = !allSelected && someSelected }}
                  onChange={toggleAll}
                  aria-label="Select all rules"
                  className="rounded border-white/20 bg-white/5 accent-primary"
                />
              </th>
              <SortHeader currentKey={sortKey} dir={sortDir} keyName="status" onSort={onSort} className="w-28">Status</SortHeader>
              <SortHeader currentKey={sortKey} dir={sortDir} keyName="partDescription" onSort={onSort} className="w-[20%]">Part description</SortHeader>
              <SortHeader currentKey={sortKey} dir={sortDir} keyName="lambdaTarget" onSort={onSort} className="w-24">Lambda</SortHeader>
              <SortHeader currentKey={sortKey} dir={sortDir} keyName="category" onSort={onSort} className="w-[22%]">Category / schema</SortHeader>
              <th className="w-[14%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Vehicle</th>
              <SortHeader currentKey={sortKey} dir={sortDir} keyName="feedbackCount" onSort={onSort} className="w-24">
                <span title="Feedback signals received · confidence. Higher = more trusted.">Activity</span>
              </SortHeader>
              <th
                title="Has a pre-mapped direct part (skips search)"
                className="w-14 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-400"
              >
                Direct
              </th>
              <SortHeader currentKey={sortKey} dir={sortDir} keyName="updatedAt" onSort={onSort} className="w-24">Updated</SortHeader>
              <th className="w-24 px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {visible.map((rule, idx) => {
              const selected = selectedIds.includes(rule.id)
              const active = activeId === rule.id
              const hasDirect = Boolean((rule as any).directPart)
              const vehicleSummary = describeVehicle(rule)
              const rowBg = active
                ? 'bg-primary/15 ring-1 ring-inset ring-primary/30'
                : selected
                ? 'bg-primary/10'
                : idx % 2
                ? 'bg-white/[0.02] hover:bg-white/[0.05]'   // zebra
                : 'hover:bg-white/[0.04]'
              return (
                <tr
                  key={rule.id}
                  onClick={() => onRowClick(rule.id)}
                  className={`group cursor-pointer transition-colors ${rowBg}`}
                >
                  <td className="px-3 py-2.5" onClick={e => { e.stopPropagation(); toggleOne(rule.id) }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleOne(rule.id)}
                      onClick={e => e.stopPropagation()}
                      aria-label={`Select ${rule.partDescription}`}
                      className="rounded border-white/20 bg-white/5 accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2.5"><StatusPill status={rule.status} /></td>
                  <td className="px-3 py-2.5 text-sm text-slate-100">
                    <div className="truncate font-medium" dir="auto" title={rule.partDescription}>
                      {rule.partDescription}
                    </div>
                    {/* click to copy the flow-decision id */}
                    <button
                      onClick={e => { e.stopPropagation(); copyText(rule.id).then(ok => (ok ? toast.success('Copied id') : toast.error('Copy failed'))) }}
                      title={`Copy id: ${rule.id}`}
                      className="mt-0.5 inline-flex max-w-full items-center gap-1 font-mono text-[10px] text-slate-500 transition-colors hover:text-sky-300"
                    >
                      <Copy className="h-3 w-3 shrink-0" /> {rule.id.slice(0, 8)}…
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-sm">
                    <span className="inline-block max-w-full truncate rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-slate-300 ring-1 ring-inset ring-white/10">
                      {rule.lambdaTarget}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm" title={`${rule.category} › ${rule.subcategory} › ${rule.schema}`}>
                    <div className="truncate font-mono text-xs text-slate-300">{rule.category} › {rule.subcategory}</div>
                    <div className="truncate font-mono text-xs text-slate-500">{rule.schema}</div>
                  </td>
                  <td className="px-3 py-2.5 text-sm">
                    {vehicleSummary ? (
                      <span
                        title={vehicleSummary}
                        className="inline-flex max-w-full items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300 ring-1 ring-inset ring-white/10"
                      >
                        <Car className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="truncate">{vehicleSummary}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">any</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><TrustSignal rule={rule} /></td>
                  <td className="px-3 py-2.5 text-center">
                    {hasDirect ? (
                      <Zap
                        aria-label="Has direct part"
                        className="mx-auto h-4 w-4 fill-emerald-400 text-emerald-400"
                      />
                    ) : (
                      <span className="sr-only">No direct part</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{formatDate(rule.updatedAt)}</td>
                  <td className="px-2 py-2.5">
                    {/* inline quick actions — appear on row hover, no need to open the editor */}
                    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {onSetStatus && rule.status !== 'approved' && (
                        <RowAction title="Approve" tone="hover:bg-emerald-500/20 hover:text-emerald-300"
                          onClick={e => { e.stopPropagation(); onSetStatus(rule.id, 'approved') }}><Check className="h-3.5 w-3.5" /></RowAction>
                      )}
                      {onSetStatus && rule.status !== 'rejected' && (
                        <RowAction title="Reject" tone="hover:bg-rose-500/20 hover:text-rose-300"
                          onClick={e => { e.stopPropagation(); onSetStatus(rule.id, 'rejected') }}><X className="h-3.5 w-3.5" /></RowAction>
                      )}
                      <RowAction title="Edit" tone="hover:bg-white/10 hover:text-slate-100"
                        onClick={e => { e.stopPropagation(); onRowClick(rule.id) }}><Pencil className="h-3.5 w-3.5" /></RowAction>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* footer: legend + pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-x border-b border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1"><Activity className="h-3.5 w-3.5 text-cyan-300" /> feedback · confidence</span>
          <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 fill-emerald-400 text-emerald-400" /> direct part (skips search)</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1">
            <span>Per page</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="rounded-md border-0 bg-white/5 px-1.5 py-0.5 text-xs text-slate-200 ring-1 ring-inset ring-white/10 focus:outline-none [&>option]:bg-slate-900"
            >
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="tabular-nums">
            {sorted.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={clampedPage <= 1}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset ring-white/10 hover:bg-white/10 disabled:opacity-30"
              aria-label="Previous page"
            ><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="tabular-nums px-1">{clampedPage}/{pageCount}</span>
            <button
              onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={clampedPage >= pageCount}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset ring-white/10 hover:bg-white/10 disabled:opacity-30"
              aria-label="Next page"
            ><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RowAction({ title, tone, onClick, children }: { title: string; tone: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      title={title} aria-label={title} onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 ring-1 ring-inset ring-white/10 transition-colors ${tone}`}
    >
      {children}
    </button>
  )
}

function SortHeader({
  currentKey,
  dir,
  keyName,
  onSort,
  className,
  children,
}: {
  currentKey: string
  dir: 'asc' | 'desc'
  keyName: SortKey
  onSort: (k: SortKey) => void
  className?: string
  children: React.ReactNode
}) {
  const isActive = currentKey === keyName
  return (
    <th className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide ${isActive ? 'text-primary' : 'text-slate-400'} ${className || ''}`}>
      <button onClick={() => onSort(keyName)} className="inline-flex items-center gap-1 transition-colors hover:text-slate-100">
        {children}
        {isActive && (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  )
}

// Compact per-rule trust signal: feedback count (usage proxy) + confidence.
// Gives operators an at-a-glance sense of how trusted/active a rule is.
function TrustSignal({ rule }: { rule: FlowDecisionRecord }) {
  const count = rule.feedbackCount ?? 0
  const conf = rule.confidence != null ? Number(rule.confidence) : null
  const tone =
    count >= 100 ? 'text-emerald-300' : count >= 10 ? 'text-cyan-300' : count > 0 ? 'text-slate-300' : 'text-slate-600'
  const confPct = conf != null && !isNaN(conf) ? `${Math.round(conf * 100)}%` : null
  return (
    <div
      className="flex items-center gap-1.5 text-xs"
      title={`${count} feedback signal${count === 1 ? '' : 's'}${confPct ? ` · ${confPct} confidence` : ''}`}
    >
      <Activity className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className={`tabular-nums font-medium ${tone}`}>{formatCount(count)}</span>
      {confPct && <span className="text-slate-500">· {confPct}</span>}
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    suggestion: 'bg-amber-500/15 text-amber-300 ring-amber-400/20',
    approved: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20',
    rejected: 'bg-rose-500/15 text-rose-300 ring-rose-400/20',
  }
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${styles[status] || 'bg-white/5 text-slate-300 ring-white/10'}`}>
      {status}
    </span>
  )
}

function describeVehicle(r: FlowDecisionRecord): string | null {
  const parts: string[] = []
  if (r.vehicleYearFrom || r.vehicleYearTo) {
    parts.push(`${r.vehicleYearFrom ?? '*'}–${r.vehicleYearTo ?? '*'}`)
  }
  if (r.vehicleModel) parts.push(r.vehicleModel)
  if (r.vehicleFuelType) parts.push(r.vehicleFuelType)
  if (r.vehicleEngineModel) parts.push(`engine: ${r.vehicleEngineModel}`)
  if (r.vinPattern) parts.push(`VIN: ${r.vinPattern}`)
  return parts.length ? parts.join(' · ') : null
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  const day = 24 * 60 * 60 * 1000
  if (diff < day) return relativeShort(diff)
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return date.toISOString().slice(0, 10)
}

function relativeShort(ms: number) {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}
