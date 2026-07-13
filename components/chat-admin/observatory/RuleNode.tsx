'use client'

import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Check, X, Minus, Trophy, Cpu, Package, AlertTriangle } from 'lucide-react'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A single reusable node card — used for the input, each candidate rule, and the resolved answer. */
function Bar({ value, tone }: { value: number | null; tone: string }) {
  const pct = value == null ? 0 : Math.round(value * 100)
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-700/60">
      <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function FilterChip({ label, state }: { label: string; state: 'ok' | 'bad' | 'unset' | 'unspec' }) {
  const map = {
    ok: { icon: <Check size={11} />, cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    bad: { icon: <X size={11} />, cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
    unset: { icon: <Minus size={11} />, cls: 'bg-slate-600/20 text-slate-400 border-slate-600/30' },
    unspec: { icon: <Minus size={11} />, cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  }[state]
  return (
    <span className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] ${map.cls}`}>
      {map.icon}{label}
    </span>
  )
}

/** Short label for the manufacturer catalog a rule belongs to (PSA / SAIC / PL). */
function schemeLabel(lt?: string): string {
  const k = (lt || '').toLowerCase()
  return k === 'partslink' ? 'PL' : k ? k.toUpperCase() : ''
}

function isNeighbor(query?: string, desc?: string): boolean {
  if (!query || !desc) return false
  const q = query.toLowerCase().trim(), d = desc.toLowerCase().trim()
  return !q.includes(d) && !d.includes(q)   // different part → the rule answers a different term
}

function filterState(reasons: string[], value: any, label: string, veh: any, key: string): 'ok' | 'bad' | 'unset' | 'unspec' {
  if (value == null || value === '') return 'unset'
  if (reasons.some((r) => r.startsWith(label) && r.includes('unspecified'))) return 'unspec'
  if (reasons.some((r) => r.startsWith(label))) return 'bad'
  return 'ok'
}

export function RuleNode({ data }: { data: any }) {
  if (data.kind === 'category' || data.kind === 'subcategory') {
    const isCat = data.kind === 'category'
    return (
      <div className={`rounded-md border px-2.5 py-1.5 text-center shadow ${isCat ? 'border-sky-500/50 bg-sky-950/50 text-sky-100' : 'border-indigo-500/40 bg-indigo-950/40 text-indigo-100'}`}>
        <Handle type="target" position={Position.Top} className="!bg-slate-500" />
        <div className="whitespace-nowrap text-[12px] font-semibold">{data.name}</div>
        <div className="text-[10px] opacity-70">{data.count} {isCat ? 'תת-קטגוריות' : 'חוקים'}</div>
        <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
      </div>
    )
  }

  if (data.kind === 'input') {
    return (
      <div className="w-64 rounded-lg border border-sky-500/40 bg-slate-800/95 p-3 text-slate-100 shadow-lg">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">שאילתה</div>
        <div className="mb-2 text-sm font-medium">{data.query}</div>
        {data.expansion?.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {data.expansion.map((e: any, i: number) => (
              <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${e.fired ? 'bg-sky-500/20 text-sky-200' : 'bg-slate-700/50 text-slate-400'}`}>
                {e.term}{e.isCanonical ? ' ★' : ''}
              </span>
            ))}
          </div>
        )}
        {data.vehicle && Object.values(data.vehicle).some(Boolean) && (
          <div className="text-[11px] text-slate-400">
            {[data.vehicle.year, data.vehicle.model, data.vehicle.fuelType, data.vehicle.engineModel].filter(Boolean).join(' · ')}
          </div>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-sky-400" />
      </div>
    )
  }

  if (data.kind === 'resolved') {
    const dp = data.directPart
    return (
      <div className="w-64 rounded-lg border border-emerald-500/50 bg-emerald-950/40 p-3 text-slate-100 shadow-lg">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
          <Trophy size={12} /> תוצאה
        </div>
        <div className="mb-2 text-[11px] leading-tight text-emerald-100">
          {data.category} <span className="text-slate-500">›</span> {data.subcategory} <span className="text-slate-500">›</span>{' '}
          <span className="font-semibold">{data.schema}</span>
        </div>
        {dp ? (
          <div className="rounded border border-slate-600/40 bg-slate-800/60 p-2 text-[11px]">
            <div className="flex items-center gap-1 font-medium"><Package size={11} /> {dp.name}</div>
            <div className="text-slate-400">מק״ט {dp.partId}</div>
            <div className="mt-1 flex items-center justify-between">
              <span>{dp.price ? `₪${dp.price}` : '—'}</span>
              <span className={dp.inStock ? 'text-emerald-400' : 'text-rose-400'}>{dp.inStock ? 'במלאי' : 'אין'}</span>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-amber-300">אין חלק מקושר (direct_part)</div>
        )}
        <Handle type="target" position={Position.Top} className="!bg-emerald-400" />
      </div>
    )
  }

  // candidate
  const veh = data.vehicle || {}
  const reasons: string[] = data.mismatchReasons || []
  // orange = another rule that answers the SAME part term but resolves elsewhere (not the winner)
  const border = data.isSelected
    ? 'border-emerald-500/60'
    : data.related
    ? 'border-orange-500/50'
    : data.nearMiss
    ? 'border-amber-500/40'
    : 'border-slate-600/40'
  const opacity = data.nearMiss || (!data.isSelected && data.status !== 'approved') ? 'opacity-70' : ''
  return (
    <div className={`w-72 rounded-lg border ${border} ${opacity} bg-slate-800/95 p-2.5 text-slate-100 shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      {/* the term THIS rule answers — makes semantic neighbors ("fuel filter" for an "oil filter" query) obvious */}
      <div className="mb-0.5 flex items-center gap-1">
        <span className="truncate text-[12px] font-semibold text-slate-100">{data.partDescription}</span>
        {isNeighbor(data.query, data.partDescription) && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">שכן סמנטי</span>
        )}
      </div>
      <div className="mb-1 flex items-center justify-between gap-1">
        <div className="truncate text-[10px] leading-tight text-slate-400">
          {data.category} › {data.subcategory} › <span className="text-slate-200">{data.schema}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          {data.lambdaTarget && <span className="rounded bg-fuchsia-500/20 px-1 text-[9px] font-semibold text-fuchsia-300">{schemeLabel(data.lambdaTarget)}</span>}
          {data.isSelected && <span className="rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-300">SIM ✓</span>}
          {data.isProduction && <span className="inline-flex items-center gap-0.5 rounded bg-indigo-500/20 px-1 text-[9px] text-indigo-300"><Cpu size={9} />PROD</span>}
          {data.nearMiss && <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">near</span>}
        </div>
      </div>
      <div className="mb-1.5 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-[10px]">
        <span className="text-slate-400">cosine {data.cosineSim ?? '—'}</span>
        <Bar value={data.cosineSim} tone="bg-sky-400" />
        <span className="text-slate-400">score {data.matchScore ?? '—'}</span>
        <Bar value={data.matchScore} tone={data.isSelected ? 'bg-emerald-400' : 'bg-slate-400'} />
      </div>
      {data.filterCount === 0 ? (
        <span className="inline-flex items-center gap-1 rounded border border-slate-500/40 bg-slate-600/25 px-1.5 py-0.5 text-[10px] text-slate-300">
          <Minus size={11} /> חוק גנרי · חל על כל הרכבים
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip label={`שנה`} state={filterState(reasons, veh.year, 'year', veh, 'year')} />
          <FilterChip label={`דגם`} state={filterState(reasons, veh.model, 'model', veh, 'model')} />
          <FilterChip label={`דלק`} state={filterState(reasons, veh.fuelType, 'fuel', veh, 'fuel')} />
          <FilterChip label={`מנוע`} state={filterState(reasons, veh.engineModel, 'engine', veh, 'engine')} />
          <span className="text-[10px] text-slate-400">{data.matched}/{data.filterCount}</span>
        </div>
      )}
      {data.status !== 'approved' && (
        <div className="mt-1 inline-flex items-center gap-0.5 text-[9px] text-amber-300"><AlertTriangle size={9} />{data.status}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </div>
  )
}

export const nodeTypes = { rule: RuleNode }
