'use client'

import { useEffect, useState, useRef } from 'react'
import { ChevronUp, ChevronDown, FlaskConical, Loader2, Sparkles } from 'lucide-react'
import { logger } from '@/lib/logger'

interface Props {
  highlightRuleId?: string | null
}

interface SimResult {
  bestMatch: {
    id: string
    category: string
    subcategory: string
    schema: string
    reasoning: string
  } | null
  matchType: string
  allCandidates: any[]
}

export function LiveSimulatorDock({ highlightRuleId }: Props) {
  const [open, setOpen] = useState(false)
  const [partDescription, setPartDescription] = useState('')
  const [vin, setVin] = useState('')
  const [year, setYear] = useState('')
  const [model, setModel] = useState('')
  const [fuelType, setFuelType] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SimResult | null>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!open) return
    if (!partDescription.trim()) {
      setResult(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Abort any in-flight request so a slow earlier response can't overwrite a
    // newer one (which would mis-highlight the "winning" rule in the editor).
    const controller = new AbortController()
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/flow-decisions/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partDescription,
            vin: vin || undefined,
            vehicleData: {
              year: year ? parseInt(year) : undefined,
              model: model || undefined,
              fuelType: fuelType || undefined,
            },
          }),
          signal: controller.signal,
        })
        const data = await res.json()
        if (!controller.signal.aborted) setResult(data)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        logger.error('Simulator dock error:', e)
        setResult(null)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      controller.abort()
    }
  }, [partDescription, vin, year, model, fuelType, open])

  const winnerIsHighlighted = result?.bestMatch && highlightRuleId === result.bestMatch.id

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-6 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <FlaskConical className="h-4 w-4 text-indigo-500" />
        <span>סימולטור חי</span>
        {result?.bestMatch && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${winnerIsHighlighted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
            {winnerIsHighlighted ? 'this rule wins' : 'rule selected'}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-6 py-3 dark:border-slate-800">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Field label="Part description (English)">
                <input
                  type="text"
                  value={partDescription}
                  onChange={e => setPartDescription(e.target.value)}
                  placeholder="e.g. oil filter"
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="VIN (optional)">
                  <input type="text" value={vin} onChange={e => setVin(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono dark:border-slate-700 dark:bg-slate-800" />
                </Field>
                <Field label="שנה">
                  <input type="number" value={year} onChange={e => setYear(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </Field>
                <Field label="דגם">
                  <input type="text" value={model} onChange={e => setModel(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </Field>
                <Field label="Fuel">
                  <input type="text" value={fuelType} onChange={e => setFuelType(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </Field>
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <Sparkles className="h-3 w-3" />
                Result
                {loading && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
              </div>
              {!partDescription.trim() ? (
                <p className="text-sm text-slate-400">Type a part description to see which rule wins.</p>
              ) : result?.bestMatch ? (
                <div className="space-y-1 text-sm">
                  <div className="text-emerald-700 dark:text-emerald-400">
                    Match type: <span className="font-mono">{result.matchType}</span>
                  </div>
                  <div className="text-slate-700 dark:text-slate-300">
                    <span className="font-mono">{result.bestMatch.category} › {result.bestMatch.subcategory} › {result.bestMatch.schema}</span>
                  </div>
                  <div className="text-xs text-slate-500">{result.bestMatch.reasoning}</div>
                  <div className="text-xs text-slate-500">{result.allCandidates?.length || 0} candidate(s) considered</div>
                </div>
              ) : !loading ? (
                <p className="text-sm text-slate-500">No rule matched.</p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
