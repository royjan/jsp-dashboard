'use client'

import React, { useState } from 'react'
import { Search, Loader2, AlertTriangle, GitBranch, ExternalLink, Car, ShieldCheck, ShieldAlert } from 'lucide-react'
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
  const [verify, setVerify] = useState<any>(null)
  const [verifying, setVerifying] = useState(false)

  const runVerify = async (partId: string, schema: string) => {
    const vin = trace?.resolvedVehicle?.vin
    if (!vin || !partId) return
    setVerifying(true); setVerify(null)
    try {
      const res = await fetch('/api/flow-decisions/verify-psa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partId, vin, expectedSchema: schema }),
      })
      setVerify(await res.json())
    } catch (e) {
      setVerify({ error: e instanceof Error ? e.message : 'failed' })
    } finally { setVerifying(false) }
  }

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
      {trace?.resolvedVehicle && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          <Car size={15} /> פוענח מהלוחית: <b>{[trace.resolvedVehicle.model, trace.resolvedVehicle.year, trace.resolvedVehicle.engineModel, trace.resolvedVehicle.fuelType].filter(Boolean).join(' · ')}</b>
          {trace.resolvedVehicle.vin && <span className="text-emerald-400/70">({trace.resolvedVehicle.vin})</span>}
        </div>
      )}
      {trace?.vehicleNote && <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200"><AlertTriangle size={15} /> {trace.vehicleNote}</div>}
      {trace?.mode === 'lexical' && <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200"><AlertTriangle size={15} /> אין embeddings — מציג התאמות לקסיקליות (ILIKE) בלבד.</div>}
      {trace?.disagree && <div className="flex items-center gap-2 rounded-md border border-indigo-500/40 bg-indigo-950/30 px-3 py-2 text-sm text-indigo-200"><GitBranch size={15} /> הסימולטור והפרודקשן בחרו חוקים <b>שונים</b> — ראה תג PROD מול SIM✓.</div>}
      {trace?.candidates?.length > 0 && trace.candidates.every((c: any) => c.filterCount === 0) && (trace.resolvedVehicle || Object.values(trace.vehicleData || {}).some(Boolean)) && (
        <div className="flex items-center gap-2 rounded-md border border-slate-500/40 bg-slate-700/30 px-3 py-2 text-sm text-slate-200">
          <AlertTriangle size={15} className="text-slate-400" /> אין חוק <b>ממוקד-רכב</b> לחלק זה — כל ההתאמות <b>גנריות</b> (חלות על כל הרכבים), כך שנתוני הרכב לא משפיעים על הבחירה. הבחירה סמנטית בלבד.
        </div>
      )}

      {/* graph + detail */}
      {trace?.candidates?.length ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <TraceGraph trace={trace} onSelect={(id) => { setSelected(id); setVerify(null) }} />
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
                {/* verify against PSA ground truth (needs a pinned part + a decoded VIN) */}
                {sel.directPart?.partId && trace?.resolvedVehicle?.vin && (
                  <div className="mt-1 border-t border-slate-700 pt-2">
                    <button onClick={() => runVerify(sel.directPart.partId, sel.schema)} disabled={verifying}
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-700 px-2.5 py-1.5 text-[12px] text-slate-100 hover:bg-slate-600 disabled:opacity-50">
                      {verifying ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} אמת מול PSA
                    </button>
                    {verify && (
                      verify.error ? (
                        <div className="mt-1.5 text-[11px] text-rose-300">{verify.error}</div>
                      ) : verify.match ? (
                        <div className="mt-1.5 flex items-center gap-1 text-[12px] text-emerald-300"><ShieldCheck size={13} /> תואם ל-PSA ✓ ({sel.schema})</div>
                      ) : (
                        <div className="mt-1.5 text-[12px] text-amber-300">
                          <div className="flex items-center gap-1"><ShieldAlert size={13} /> אי-התאמה ל-PSA</div>
                          <div className="text-[11px] text-slate-300">החוק: {sel.schema}</div>
                          <div className="text-[11px] text-slate-300">PSA: {(verify.schemas || []).join(', ') || 'לא נמצא'}</div>
                        </div>
                      )
                    )}
                  </div>
                )}
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
