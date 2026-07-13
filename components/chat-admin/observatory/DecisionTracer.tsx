'use client'

import React, { useState } from 'react'
import { Search, Loader2, AlertTriangle, GitBranch, ExternalLink } from 'lucide-react'
import SimulatorVehicleInput, { type VehicleInputData } from '@/components/chat-admin/SimulatorVehicleInput'
import { TraceGraph } from './TraceGraph'

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_OPTS = [
  { key: 'approved', label: 'מאושר' },
  { key: 'suggestion', label: 'הצעה' },
  { key: 'rejected', label: 'נדחה' },
] as const

export default function DecisionTracer({ initialQuery = '' }: { initialQuery?: string }) {
  const [part, setPart] = useState(initialQuery)
  const [vehicle, setVehicle] = useState<VehicleInputData>({})
  const [statuses, setStatuses] = useState<string[]>(['approved'])
  const [nearMiss, setNearMiss] = useState(true)
  const [loading, setLoading] = useState(false)
  const [trace, setTrace] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const run = async () => {
    if (!part.trim()) return
    setLoading(true); setError(null); setSelected(null)
    try {
      const res = await fetch('/api/flow-decisions/trace', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partDescription: part.trim(),
          vehicleData: { year: vehicle.year, model: vehicle.model, fuelType: vehicle.fuelType, engineModel: vehicle.engineModel },
          vin: vehicle.vin, licensePlate: vehicle.licensePlate,
          includeStatuses: statuses, nearMissFloor: nearMiss ? 0.45 : 0.6,
        }),
      })
      const data = await res.json()
      if (data.error) setError(data.error)
      setTrace(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trace failed')
    } finally { setLoading(false) }
  }

  const sel = trace?.candidates?.find((c: any) => c.id === selected)

  return (
    <div className="space-y-3">
      {/* input */}
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={part} onChange={(e) => setPart(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="תיאור חלק (למשל: מסנן שמן / oil filter)"
              className="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <button onClick={run} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} עקוב
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <span>סטטוסים:</span>
            {STATUS_OPTS.map((s) => (
              <label key={s.key} className="inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={statuses.includes(s.key)}
                  onChange={(e) => setStatuses((p) => e.target.checked ? [...p, s.key] : p.filter((x) => x !== s.key))} />
                {s.label}
              </label>
            ))}
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={nearMiss} onChange={(e) => setNearMiss(e.target.checked)} /> כולל near-miss
            </label>
          </div>
        </div>
        <div className="min-w-[260px]"><SimulatorVehicleInput onVehicleDataChange={setVehicle} /></div>
      </div>

      {/* banners */}
      {error && <div className="flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"><AlertTriangle size={15} /> {error}</div>}
      {trace?.mode === 'lexical' && <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200"><AlertTriangle size={15} /> אין embeddings — מציג התאמות לקסיקליות (ILIKE) בלבד.</div>}
      {trace?.disagree && <div className="flex items-center gap-2 rounded-md border border-indigo-500/40 bg-indigo-950/30 px-3 py-2 text-sm text-indigo-200"><GitBranch size={15} /> הסימולטור והפרודקשן בחרו חוקים <b>שונים</b> — ראה תג PROD מול SIM✓.</div>}

      {/* graph + detail */}
      {trace?.candidates?.length ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <TraceGraph trace={trace} onSelect={setSelected} />
          <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-200">
            {sel ? (
              <div className="space-y-2">
                <div className="text-[11px] leading-tight text-slate-300">{sel.category} › {sel.subcategory} › <b>{sel.schema}</b></div>
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <span>cosine: <b>{sel.cosineSim ?? '—'}</b></span>
                  <span>score: <b>{sel.matchScore ?? '—'}</b></span>
                  <span>vehicle: <b>{sel.vehicleScore != null ? `${Math.round(sel.vehicleScore * 100)}%` : '—'}</b></span>
                  <span>filters: <b>{sel.matched}/{sel.filterCount}</b></span>
                  <span>status: <b>{sel.status}</b></span>
                  <span>source: <b>{sel.source || 'manual'}</b></span>
                  <span>lambda: <b>{sel.lambdaTarget}</b></span>
                  <span>term: <b>{sel.winningTerm}</b></span>
                </div>
                {sel.mismatchReasons?.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-rose-300">מדוע לא נבחר:</div>
                    <ul className="list-disc pr-4 text-[11px] text-slate-400">{sel.mismatchReasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                <a href={`/chat/flow-decisions/edit/${sel.id}`} className="inline-flex items-center gap-1 text-[12px] text-sky-400 hover:underline">
                  <ExternalLink size={12} /> ערוך חוק
                </a>
              </div>
            ) : (
              <div className="text-[12px] text-slate-500">לחץ על צומת חוק כדי לראות פרטים מלאים (cosine, פילטרים, סיבות דחייה, החלק המקושר).</div>
            )}
          </div>
        </div>
      ) : trace && !loading && !error ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-6 text-center text-sm text-slate-400">לא נמצאו חוקים תואמים.</div>
      ) : null}
    </div>
  )
}
