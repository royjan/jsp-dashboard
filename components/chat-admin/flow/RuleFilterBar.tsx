'use client'

import { Search, X } from 'lucide-react'
import type { FlowDecisionStatus } from '@/types/chat-admin/flow-decision'
import { L, he } from './labels'

export interface RuleFilters {
  search: string
  // exact catalog-path scope (from the Observatory catalog drill-down) — matched exactly,
  // unlike `search` which is a free-text substring across all fields
  category: string
  subcategory: string
  schema: string
  status: FlowDecisionStatus[]
  source: 'all' | 'manual' | 'learned'
  lambdaTarget: string[]
  yearFrom: string
  yearTo: string
  model: string
  fuelType: string
  engineModel: string
  vinPattern: string
  hasDirectPart: 'any' | 'yes' | 'no'
  hasVehicleFilters: 'any' | 'yes' | 'no'
}

const STATUSES: FlowDecisionStatus[] = ['suggestion', 'approved', 'rejected']
const LAMBDAS = ['partslink', 'psa', 'vin17', 'qipei']

interface Props {
  filters: RuleFilters
  onChange: (next: RuleFilters) => void
  onReset: () => void
}

export function RuleFilterBar({ filters, onChange, onReset }: Props) {
  const set = <K extends keyof RuleFilters>(key: K, value: RuleFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const toggleArray = <T extends string>(current: T[], value: T): T[] =>
    current.includes(value) ? current.filter(v => v !== value) : [...current, value]

  const activeCount =
    (filters.search ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.subcategory ? 1 : 0) +
    (filters.schema ? 1 : 0) +
    filters.status.length +
    (filters.source !== 'all' ? 1 : 0) +
    filters.lambdaTarget.length +
    (filters.yearFrom ? 1 : 0) +
    (filters.yearTo ? 1 : 0) +
    (filters.model ? 1 : 0) +
    (filters.fuelType ? 1 : 0) +
    (filters.engineModel ? 1 : 0) +
    (filters.vinPattern ? 1 : 0) +
    (filters.hasDirectPart !== 'any' ? 1 : 0) +
    (filters.hasVehicleFilters !== 'any' ? 1 : 0)

  return (
    <div className="border-t border-white/10 px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={filters.search}
            onChange={e => set('search', e.target.value)}
            placeholder="חיפוש לפי תיאור חלק, קטגוריה או שרטוט…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {(filters.category || filters.subcategory || filters.schema) && (
          <ChipGroup label={L.scope}>
            {filters.category && <ScopeChip label={filters.category} onClear={() => set('category', '')} />}
            {filters.subcategory && <ScopeChip label={filters.subcategory} onClear={() => set('subcategory', '')} />}
            {filters.schema && <ScopeChip label={filters.schema} onClear={() => set('schema', '')} />}
          </ChipGroup>
        )}

        <ChipGroup label={L.status}>
          {STATUSES.map(s => (
            <Chip key={s} active={filters.status.includes(s)} onClick={() => set('status', toggleArray(filters.status, s))}>
              {he(s)}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label={L.source}>
          <SelectChip
            value={filters.source}
            options={[{ v: 'all', l: he('all') }, { v: 'manual', l: he('manual') }, { v: 'learned', l: he('learned (pins)') }]}
            onChange={v => set('source', v as RuleFilters['source'])}
          />
        </ChipGroup>

        <ChipGroup label={L.lambda}>
          {LAMBDAS.map(l => (
            <Chip key={l} active={filters.lambdaTarget.includes(l)} onClick={() => set('lambdaTarget', toggleArray(filters.lambdaTarget, l))}>
              {he(l)}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label={L.vehicleFilters}>
          <SelectChip
            value={filters.hasVehicleFilters}
            options={[{ v: 'any', l: he('any') }, { v: 'yes', l: he('has filters') }, { v: 'no', l: he('no filters') }]}
            onChange={v => set('hasVehicleFilters', v as RuleFilters['hasVehicleFilters'])}
          />
        </ChipGroup>

        <ChipGroup label={'מק"ט ישיר'}>
          <SelectChip
            value={filters.hasDirectPart}
            options={[{ v: 'any', l: 'any' }, { v: 'yes', l: 'has direct part' }, { v: 'no', l: 'no direct part' }]}
            onChange={v => set('hasDirectPart', v as RuleFilters['hasDirectPart'])}
          />
        </ChipGroup>

        {activeCount > 0 && (
          <button
            onClick={onReset}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
          >
            <X className="h-3 w-3" /> Clear all ({activeCount})
          </button>
        )}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer select-none text-xs text-slate-400 transition-colors hover:text-slate-200">
          Advanced filters (year, model, fuel, engine, VIN)
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          <NumberField placeholder={L.yearFrom} value={filters.yearFrom} onChange={v => set('yearFrom', v)} />
          <NumberField placeholder={L.yearTo} value={filters.yearTo} onChange={v => set('yearTo', v)} />
          <TextField placeholder={L.model} value={filters.model} onChange={v => set('model', v)} />
          <TextField placeholder={L.fuelType} value={filters.fuelType} onChange={v => set('fuelType', v)} />
          <TextField placeholder={L.engineModel} value={filters.engineModel} onChange={v => set('engineModel', v)} />
          <TextField placeholder={L.vinPattern} value={filters.vinPattern} onChange={v => set('vinPattern', v)} />
        </div>
      </details>
    </div>
  )
}

function ScopeChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-fuchsia-500/15 px-2.5 py-1 text-xs font-medium text-fuchsia-200 ring-1 ring-inset ring-fuchsia-400/30">
      <span className="truncate">{label}</span>
      <button onClick={onClear} className="shrink-0 rounded-full p-0.5 hover:bg-white/10" aria-label="נקה תחולה">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}:</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
        active
          ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/30 ring-1 ring-inset ring-white/20'
          : 'bg-white/5 text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/10 hover:text-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function SelectChip({
  value,
  options,
  onChange,
}: {
  value: string
  options: { v: string; l: string }[]
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-full border-0 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-ring [&>option]:bg-slate-900 [&>option]:text-slate-100"
    >
      {options.map(o => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  )
}

function NumberField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-2 focus:ring-ring"
    />
  )
}

function TextField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-2 focus:ring-ring"
    />
  )
}
