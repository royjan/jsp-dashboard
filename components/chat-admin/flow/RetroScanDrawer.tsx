'use client'

import { useState, useRef } from 'react'
import { X, Loader2, ScanSearch, Check, XCircle } from 'lucide-react'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/hooks/use-modal-a11y'
import { L } from './labels'

interface ScanSuggestion {
  partDescription: string
  category: string
  subcategory: string
  schema: string
  lambdaTarget: string
  occurrences: number
  vehicleFilters?: Record<string, any>
}

interface Props {
  onClose: () => void
  onApplied: () => Promise<void> | void
}

export function RetroScanDrawer({ onClose, onApplied }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(panelRef, onClose)
  const [scanning, setScanning] = useState(false)
  const [suggestions, setSuggestions] = useState<ScanSuggestion[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [limit, setLimit] = useState(50)
  const [daysBack, setDaysBack] = useState(30)
  const [scanned, setScanned] = useState(false)

  const scan = async () => {
    setScanning(true)
    setScanned(false)
    setSuggestions([])
    setSelected(new Set())
    try {
      const res = await fetch('/api/flow-decisions/retro-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, daysBack }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Scan failed')
      const data = await res.json()
      setSuggestions(data.suggestions || [])
      setScanned(true)
    } catch (e) {
      logger.error('Retro-scan failed:', e)
      toast.error(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const toggle = (i: number) => {
    const next = new Set(selected)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setSelected(next)
  }

  const apply = async () => {
    const items = Array.from(selected).map(i => suggestions[i])
    if (items.length === 0) return
    try {
      for (const s of items) {
        await fetch('/api/flow-decisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partDescription: s.partDescription,
            flowDecision: { category: s.category, subcategory: s.subcategory, schema: s.schema },
            lambdaTarget: s.lambdaTarget,
            vehicleFilters: s.vehicleFilters,
          }),
        })
      }
      toast.success(`Created ${items.length} suggestion${items.length === 1 ? '' : 's'}`)
      await onApplied()
      onClose()
    } catch (e) {
      logger.error('Apply suggestions failed:', e)
      toast.error(L.applySomeFailed)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30" role="dialog" aria-modal="true" aria-label={L.retroTitle} onClick={onClose}>
      <div ref={panelRef} className="fixed inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-slate-900" onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <ScanSearch className="h-5 w-5 text-indigo-500" />
            {L.retroTitle}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={L.close}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="mb-3 text-slate-600 dark:text-slate-400">
            {L.retroBlurb}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{L.daysBack}</span>
              <input type="number" value={daysBack} onChange={e => setDaysBack(parseInt(e.target.value) || 30)}
                className="mt-1 block w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800" />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{L.maxSuggestions}</span>
              <input type="number" value={limit} onChange={e => setLimit(parseInt(e.target.value) || 50)}
                className="mt-1 block w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800" />
            </label>
            <button
              onClick={scan}
              disabled={scanning}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {L.runScan}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!scanned && !scanning && (
            <p className="py-10 text-center text-sm text-slate-500">{L.retroIdle}</p>
          )}
          {scanning && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Loader2 className="mb-2 h-6 w-6 animate-spin" />
              {L.retroScanning}
            </div>
          )}
          {scanned && suggestions.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">{L.retroEmpty}</p>
          )}
          {suggestions.length > 0 && (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  onClick={() => toggle(i)}
                  className={`flex cursor-pointer items-start gap-3 rounded-md px-2 py-3 transition-colors ${
                    selected.has(i) ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="mt-1 rounded border-slate-300" />
                  <div className="flex-1">
                    <div className="font-medium text-slate-900 dark:text-slate-100" dir="auto">{s.partDescription}</div>
                    <div className="text-xs text-slate-500">
                      <span className="font-mono">{s.lambdaTarget}</span> · {s.category} › {s.subcategory} › {s.schema}
                      {s.occurrences && <> · {L.seen} {s.occurrences}×</>}
                    </div>
                    {s.vehicleFilters && Object.keys(s.vehicleFilters).length > 0 && (
                      <div className="mt-1 text-xs text-slate-400">{L.filters}: {JSON.stringify(s.vehicleFilters)}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">{L.selectedOf(selected.size, suggestions.length)}</span>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                {L.cancel}
              </button>
              <button
                onClick={apply}
                disabled={selected.size === 0}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {L.createSuggestions(selected.size)}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
