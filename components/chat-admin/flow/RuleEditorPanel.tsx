'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Save, Trash2, Check, XCircle, Loader2, Car } from 'lucide-react'
import type { FlowDecisionRecord } from '@/types/chat-admin/flow-decision'
import AutocompleteInput from './AutocompleteInput'
import { VinDecodeSection } from './VinDecodeSection'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'

const LAMBDAS = ['partslink', 'psa', 'vin17', 'qipei']
const STATUSES = ['suggestion', 'approved', 'rejected'] as const

type Tab = 'match' | 'action' | 'history'

interface Props {
  rule: FlowDecisionRecord | null
  isCreating: boolean
  seedDescription?: string
  onClose: () => void
  onSaved: () => Promise<void> | void
  onDeleted: () => Promise<void> | void
}

interface AutocompleteData {
  partDescriptions: string[]
  categories: string[]
  subcategories: string[]
  schemas: string[]
}

const EMPTY_AUTOCOMPLETE: AutocompleteData = {
  partDescriptions: [],
  categories: [],
  subcategories: [],
  schemas: [],
}

export function RuleEditorPanel({ rule, isCreating, seedDescription, onClose, onSaved, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>('match')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [autocomplete, setAutocomplete] = useState<AutocompleteData>(EMPTY_AUTOCOMPLETE)

  const [form, setForm] = useState(() => initialForm(rule, seedDescription))

  useEffect(() => {
    setForm(initialForm(rule, seedDescription))
    setTab('match')
  }, [rule?.id, isCreating, seedDescription])

  useEffect(() => {
    let cancelled = false
    const lambda = form.lambdaTarget || 'all'
    fetch(`/api/flow-decisions/autocomplete?lambdaId=${encodeURIComponent(lambda)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        const pluck = (xs: any[] | undefined): string[] =>
          Array.isArray(xs) ? xs.map(x => (typeof x === 'string' ? x : x?.en)).filter(Boolean) : []
        setAutocomplete({
          partDescriptions: pluck(d.partDescriptions),
          categories: pluck(d.categories),
          subcategories: pluck(d.subcategories),
          schemas: pluck(d.schemas),
        })
      })
      .catch(() => {
        if (!cancelled) setAutocomplete(EMPTY_AUTOCOMPLETE)
      })
    return () => { cancelled = true }
  }, [form.lambdaTarget])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const save = useCallback(async (statusOverride?: 'approved' | 'rejected' | 'suggestion') => {
    if (!form.partDescription.trim()) {
      toast.error('Part description is required')
      return
    }
    if (!form.category.trim() || !form.subcategory.trim() || !form.schema.trim()) {
      toast.error('Category, subcategory, and schema are required')
      return
    }
    setSaving(true)
    try {
      const body = {
        partDescription: form.partDescription.trim(),
        flowDecision: {
          category: form.category.trim(),
          subcategory: form.subcategory.trim(),
          schema: form.schema.trim(),
        },
        lambdaTarget: form.lambdaTarget,
        vehicleFilters: buildVehicleFilters(form),
      }
      let saved: FlowDecisionRecord
      if (isCreating || !rule) {
        const res = await fetch('/api/flow-decisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Create failed')
        saved = await res.json()
      } else {
        const res = await fetch('/api/flow-decisions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: rule.id, ...body }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Update failed')
        saved = await res.json()
      }
      const targetStatus = statusOverride || form.status
      if (saved && targetStatus !== saved.status) {
        await fetch(`/api/flow-decisions/${saved.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: targetStatus }),
        })
      }
      toast.success(isCreating ? 'Rule created' : 'Rule updated')
      await onSaved()
    } catch (e) {
      logger.error('Save rule failed:', e)
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [form, rule, isCreating, onSaved])

  const remove = useCallback(async () => {
    if (!rule) return
    if (!confirm('Delete this rule? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/flow-decisions/${rule.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Rule deleted')
      await onDeleted()
    } catch (e) {
      logger.error('Delete failed:', e)
      toast.error('Delete failed')
    } finally {
      setDeleting(false)
    }
  }, [rule, onDeleted])

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900" role="dialog" aria-label={isCreating ? 'New flow decision' : 'Edit flow decision'}>
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isCreating ? 'New rule' : 'Edit rule'}
          </h2>
          <StatusBadge status={form.status} />
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close editor">
          <X className="h-5 w-5" />
        </button>
      </header>

      <nav className="flex border-b border-slate-200 px-5 dark:border-slate-800">
        <TabButton active={tab === 'match'} onClick={() => setTab('match')}>Match</TabButton>
        <TabButton active={tab === 'action'} onClick={() => setTab('action')}>Action</TabButton>
        {!isCreating && <TabButton active={tab === 'history'} onClick={() => setTab('history')}>History</TabButton>}
      </nav>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tab === 'match' && (
          <div className="space-y-4">
            <Field label="Part description (English)" required>
              <AutocompleteInput
                value={form.partDescription}
                onChange={v => set('partDescription', v)}
                suggestions={autocomplete.partDescriptions}
                placeholder="e.g. oil filter, brake pad set"
                id="rule-part-description"
              />
            </Field>

            <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <Car className="mr-1 inline h-3 w-3" />
                Vehicle filters (optional)
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Year from"><NumberInput value={form.vehicleYearFrom} onChange={v => set('vehicleYearFrom', v)} /></Field>
                <Field label="Year to"><NumberInput value={form.vehicleYearTo} onChange={v => set('vehicleYearTo', v)} /></Field>
                <Field label="Model"><TextInput value={form.vehicleModel} onChange={v => set('vehicleModel', v)} /></Field>
                <Field label="Fuel type"><TextInput value={form.vehicleFuelType} onChange={v => set('vehicleFuelType', v)} placeholder="petrol, diesel, electric..." /></Field>
                <Field label="Engine model"><TextInput value={form.vehicleEngineModel} onChange={v => set('vehicleEngineModel', v)} /></Field>
                <Field label="VIN pattern"><TextInput value={form.vinPattern} onChange={v => set('vinPattern', v)} placeholder="WAUZZZ..." /></Field>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">Decode VIN to autofill</summary>
                <div className="mt-2">
                  <VinDecodeSection
                    defaultCollapsed={false}
                    onVehicleDecoded={(v) => {
                      if (v?.year) set('vehicleYearFrom', String(v.year))
                      if (v?.model) set('vehicleModel', v.model)
                      if (v?.fuelType) set('vehicleFuelType', v.fuelType)
                      if (v?.engineModel) set('vehicleEngineModel', v.engineModel)
                    }}
                  />
                </div>
              </details>
            </fieldset>
          </div>
        )}

        {tab === 'action' && (
          <div className="space-y-4">
            <Field label="Lambda target" required>
              <select
                value={form.lambdaTarget}
                onChange={e => set('lambdaTarget', e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {LAMBDAS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Category" required>
                <AutocompleteInput
                  value={form.category}
                  onChange={v => set('category', v)}
                  suggestions={autocomplete.categories}
                  placeholder="e.g. Engine, Body, Brakes"
                  id="rule-category"
                />
              </Field>
              <Field label="Subcategory" required>
                <AutocompleteInput
                  value={form.subcategory}
                  onChange={v => set('subcategory', v)}
                  suggestions={autocomplete.subcategories}
                  placeholder="e.g. Filters, Sensors, Belts"
                  id="rule-subcategory"
                />
              </Field>
              <Field label="Schema" required>
                <AutocompleteInput
                  value={form.schema}
                  onChange={v => set('schema', v)}
                  suggestions={autocomplete.schemas}
                  placeholder="e.g. ENGINE OIL FILTER"
                  id="rule-schema"
                />
              </Field>
            </div>
          </div>
        )}

        {tab === 'history' && rule && (
          <dl className="space-y-3 text-sm">
            <Row label="Created"><span className="font-mono">{formatDate(rule.createdAt)}</span> {rule.createdBy && `by ${rule.createdBy}`}</Row>
            <Row label="Updated"><span className="font-mono">{formatDate(rule.updatedAt)}</span></Row>
            {rule.approvedAt && <Row label="Approved"><span className="font-mono">{formatDate(rule.approvedAt)}</span> {rule.approvedBy && `by ${rule.approvedBy}`}</Row>}
            {rule.rejectedAt && <Row label="Rejected"><span className="font-mono">{formatDate(rule.rejectedAt)}</span> {rule.rejectedBy && `by ${rule.rejectedBy}`}</Row>}
            {rule.rejectionReason && <Row label="Rejection reason">{rule.rejectionReason}</Row>}
            {rule.source && <Row label="Source">{rule.source}</Row>}
            {rule.confidence != null && <Row label="Confidence">{Number(rule.confidence).toFixed(2)}</Row>}
            {rule.feedbackCount > 0 && <Row label="Feedback count">{rule.feedbackCount}</Row>}
          </dl>
        )}
      </div>

      <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-center gap-2">
          <select
            value={form.status}
            onChange={e => set('status', e.target.value as typeof form.status)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <div className="ml-auto flex gap-2">
            {!isCreating && rule && (
              <button
                onClick={remove}
                disabled={deleting}
                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            )}
            <button
              onClick={() => save('rejected')}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <XCircle className="h-4 w-4" /> Save & reject
            </button>
            <button
              onClick={() => save('approved')}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save & approve
            </button>
            <button
              onClick={() => save()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

interface FormState {
  partDescription: string
  category: string
  subcategory: string
  schema: string
  lambdaTarget: string
  status: 'suggestion' | 'approved' | 'rejected'
  vehicleYearFrom: string
  vehicleYearTo: string
  vehicleModel: string
  vehicleFuelType: string
  vehicleEngineModel: string
  vinPattern: string
}

function initialForm(rule: FlowDecisionRecord | null, seedDescription?: string): FormState {
  if (rule) {
    return {
      partDescription: rule.partDescription,
      category: rule.category,
      subcategory: rule.subcategory,
      schema: rule.schema,
      lambdaTarget: rule.lambdaTarget,
      status: rule.status,
      vehicleYearFrom: rule.vehicleYearFrom?.toString() ?? '',
      vehicleYearTo: rule.vehicleYearTo?.toString() ?? '',
      vehicleModel: rule.vehicleModel ?? '',
      vehicleFuelType: rule.vehicleFuelType ?? '',
      vehicleEngineModel: rule.vehicleEngineModel ?? '',
      vinPattern: rule.vinPattern ?? '',
    }
  }
  return {
    partDescription: seedDescription || '',
    category: '',
    subcategory: '',
    schema: '',
    lambdaTarget: 'partslink',
    status: 'approved',
    vehicleYearFrom: '',
    vehicleYearTo: '',
    vehicleModel: '',
    vehicleFuelType: '',
    vehicleEngineModel: '',
    vinPattern: '',
  }
}

function buildVehicleFilters(f: FormState) {
  const out: Record<string, any> = {}
  if (f.vehicleYearFrom) out.yearFrom = parseInt(f.vehicleYearFrom)
  if (f.vehicleYearTo) out.yearTo = parseInt(f.vehicleYearTo)
  if (f.vehicleModel) out.model = f.vehicleModel
  if (f.vehicleFuelType) out.fuelType = f.vehicleFuelType
  if (f.vehicleEngineModel) out.engineModel = f.vehicleEngineModel
  if (f.vinPattern) out.vinPattern = f.vinPattern
  return Object.keys(out).length ? out : undefined
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active
          ? 'border-indigo-500 text-indigo-700 dark:text-indigo-400'
          : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
    />
  )
}

function NumberInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
    />
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    suggestion: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-slate-100 text-slate-700'}`}>{status}</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 dark:border-slate-800">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-700 dark:text-slate-300">{children}</dd>
    </div>
  )
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 16).replace('T', ' ')
}
