'use client'

import { useState, useEffect, useRef, useCallback, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Check,
  Loader2,
  Car,
  Package,
  Layers,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  FlaskConical,
  Globe,
  MapPin,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import type { FlowDecisionRecord } from '@/types/chat-admin/flow-decision'
import AutocompleteInput from './AutocompleteInput'
import { VinDecodeSection } from './VinDecodeSection'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { L } from './labels'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface Props {
  seedDescription?: string
  /** Vehicle filters pre-filled from a real conversation turn ("create rule from this turn"). */
  seedVehicle?: {
    yearFrom?: string
    yearTo?: string
    model?: string
    fuelType?: string
    engineModel?: string
  }
  /** Existing rules, used to warn before creating a duplicate/conflict. */
  existingRules?: FlowDecisionRecord[]
  onClose: () => void
  onSaved: () => Promise<void> | void
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

interface SupplierDef {
  id: string
  name: string
  blurb: string
  // explicit dark-mode-safe accent classes (no `dark:` variants)
  ringSelected: string
  glow: string
  iconBg: string
  iconText: string
  chip: string
}

const SUPPLIERS: SupplierDef[] = [
  {
    id: 'partslink',
    name: 'PartsLink',
    blurb: 'Primary multi-brand parts catalog',
    ringSelected: 'ring-indigo-400/80 border-indigo-400/60',
    glow: 'bg-indigo-500/30',
    iconBg: 'bg-indigo-500/15',
    iconText: 'text-indigo-300',
    chip: 'text-indigo-200',
  },
  {
    id: 'psa',
    name: 'PSA',
    blurb: 'Peugeot · Citroën · Opel · Vauxhall',
    ringSelected: 'ring-emerald-400/80 border-emerald-400/60',
    glow: 'bg-emerald-500/30',
    iconBg: 'bg-emerald-500/15',
    iconText: 'text-emerald-300',
    chip: 'text-emerald-200',
  },
  {
    id: 'vin17',
    name: 'VIN17',
    blurb: 'Chinese brands · MG/SAIC · Xiaopeng · Geely',
    ringSelected: 'ring-rose-400/80 border-rose-400/60',
    glow: 'bg-rose-500/30',
    iconBg: 'bg-rose-500/15',
    iconText: 'text-rose-300',
    chip: 'text-rose-200',
  },
  {
    id: 'qipei',
    name: 'Qipei',
    blurb: 'BYD electric vehicles',
    ringSelected: 'ring-amber-400/80 border-amber-400/60',
    glow: 'bg-amber-500/30',
    iconBg: 'bg-amber-500/15',
    iconText: 'text-amber-300',
    chip: 'text-amber-200',
  },
]

const supplierById = (id: string) => SUPPLIERS.find(s => s.id === id) ?? SUPPLIERS[0]

interface WizardState {
  partDescription: string
  // designed as a set to allow multi-select later; UI is single-select for now
  suppliers: string[]
  vehicleScope: 'all' | 'specific'
  yearFrom: string
  yearTo: string
  model: string
  fuelType: string
  engineModel: string
  vinPattern: string
  category: string
  subcategory: string
  schema: string
  directPartId: string
  directPartName: string
  lookupVin: string
}

const STEPS = [
  { key: 'part', label: 'Part', icon: Package },
  { key: 'supplier', label: 'Supplier', icon: Globe },
  { key: 'vehicles', label: 'Vehicles', icon: Car },
  { key: 'mapping', label: 'Catalog', icon: Layers },
  { key: 'review', label: 'Review', icon: FlaskConical },
] as const

type StepIndex = 0 | 1 | 2 | 3 | 4

interface SimulateResult {
  success: boolean
  bestMatch?: {
    category?: string
    subcategory?: string
    schema?: string
    confidence?: number
    reasoning?: string
    filters?: unknown
  }
  matchType?: string
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function CreateFlowWizard({ seedDescription, seedVehicle, existingRules = [], onClose, onSaved }: Props) {
  const [step, setStep] = useState<StepIndex>(0)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [saving, setSaving] = useState(false)
  const [autocomplete, setAutocomplete] = useState<AutocompleteData>(EMPTY_AUTOCOMPLETE)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<WizardState>(() => ({
    partDescription: seedDescription || '',
    suppliers: ['partslink'],
    vehicleScope: seedVehicle && Object.values(seedVehicle).some(Boolean) ? 'specific' : 'all',
    yearFrom: seedVehicle?.yearFrom || '',
    yearTo: seedVehicle?.yearTo || '',
    model: seedVehicle?.model || '',
    fuelType: seedVehicle?.fuelType || '',
    engineModel: seedVehicle?.engineModel || '',
    vinPattern: '',
    category: '',
    subcategory: '',
    schema: '',
    directPartId: '',
    directPartName: '',
    lookupVin: '',
  }))

  const panelRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  const set = useCallback(<K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  // Auto-fill the catalog path (category/subcategory/schema) from a direct part number.
  // Fast when the part is already pinned; otherwise a live PSA lookup (needs the VIN, slow).
  const [resolving, setResolving] = useState(false)
  const [resolveMsg, setResolveMsg] = useState<{ kind: 'ok' | 'info' | 'error'; text: string } | null>(null)
  const autoFillByPartId = useCallback(async () => {
    const pid = form.directPartId.trim()
    if (!pid) {
      setResolveMsg({ kind: 'error', text: 'Enter a direct part number first.' })
      return
    }
    setResolving(true)
    setResolveMsg(null)
    try {
      const res = await fetch('/api/flow-decisions/resolve-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partId: pid, vin: form.lookupVin.trim() || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || 'Lookup failed')
      if (d.found) {
        setForm(prev => ({
          ...prev,
          category: d.category || prev.category,
          subcategory: d.subcategory || prev.subcategory,
          schema: d.schema || prev.schema,
          directPartName: prev.directPartName || d.name || '',
        }))
        setResolveMsg({
          kind: 'ok',
          text: d.source === 'cache' ? 'Filled from a known part ✓' : 'Filled from the live PSA catalog ✓',
        })
      } else if (d.needsVin) {
        setResolveMsg({ kind: 'info', text: 'New part — enter the VIN below to look it up live in PSA (can take up to ~90s).' })
      } else {
        setResolveMsg({ kind: 'error', text: d.error || 'Could not resolve this part.' })
      }
    } catch (e) {
      setResolveMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Lookup failed.' })
    } finally {
      setResolving(false)
    }
  }, [form.directPartId, form.lookupVin])

  const lambda = form.suppliers[0] || 'partslink'

  // Warn if an identical rule (same part + supplier + vehicle scope) already
  // exists — mirrors the DB unique constraint so the operator catches conflicts
  // before hitting Save instead of seeing a raw server error.
  const duplicate = findDuplicateRule(existingRules, form, lambda)

  // Load autocomplete suggestions scoped to selected supplier
  useEffect(() => {
    let cancelled = false
    fetch(`/api/flow-decisions/autocomplete?lambdaId=${encodeURIComponent(lambda)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        const pluck = (xs: unknown): string[] =>
          Array.isArray(xs)
            ? xs
                .map(x => (typeof x === 'string' ? x : (x as { en?: string })?.en))
                .filter((v): v is string => Boolean(v))
            : []
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
    return () => {
      cancelled = true
    }
  }, [lambda])

  // Focus management + ESC + body scroll lock + focus trap
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const t = setTimeout(() => firstInputRef.current?.focus(), 120)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  // ── Validation per step ────────────────────────────────────────────────────
  const stepValid = useCallback(
    (s: StepIndex): boolean => {
      switch (s) {
        case 0:
          return form.partDescription.trim().length > 0
        case 1:
          return form.suppliers.length > 0
        case 2:
          return true
        case 3:
          return (
            form.category.trim().length > 0 &&
            form.subcategory.trim().length > 0 &&
            form.schema.trim().length > 0
          )
        case 4:
          return true
      }
    },
    [form]
  )

  const goTo = useCallback((next: StepIndex) => {
    setDirection(next > step ? 1 : -1)
    setError(null)
    setStep(next)
  }, [step])

  const next = useCallback(() => {
    if (!stepValid(step)) {
      setError(stepErrorMessage(step))
      return
    }
    if (step < 4) goTo((step + 1) as StepIndex)
  }, [step, stepValid, goTo])

  const back = useCallback(() => {
    if (step > 0) goTo((step - 1) as StepIndex)
  }, [step, goTo])

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = useCallback(
    async (status: 'approved' | 'suggestion') => {
      // Validate required fields, jump to offending step on miss
      if (!form.partDescription.trim()) {
        goTo(0)
        setError('Please tell us which part the customer is asking for.')
        return
      }
      if (form.suppliers.length === 0) {
        goTo(1)
        setError('Please choose a supplier to search.')
        return
      }
      if (!form.category.trim() || !form.subcategory.trim() || !form.schema.trim()) {
        goTo(3)
        setError('Catalog mapping is required: fill category, subcategory and schema.')
        return
      }

      setSaving(true)
      setError(null)
      try {
        const vehicleFilters = buildVehicleFilters(form)
        const directPartId = form.directPartId.trim()
        const body = {
          partDescription: form.partDescription.trim(),
          flowDecision: {
            category: form.category.trim(),
            subcategory: form.subcategory.trim(),
            schema: form.schema.trim(),
          },
          lambdaTarget: lambda,
          ...(vehicleFilters ? { vehicleFilters } : {}),
          ...(directPartId
            ? { directPart: { partId: directPartId, name: form.directPartName.trim() || undefined } }
            : {}),
        }
        const res = await fetch('/api/flow-decisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || 'Create failed')
        }
        const saved: FlowDecisionRecord = await res.json()

        if (saved?.id && status !== saved.status) {
          await fetch(`/api/flow-decisions/${saved.id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          })
        }
        toast.success(status === 'approved' ? 'Rule created & approved' : 'Rule saved as suggestion')
        await onSaved()
      } catch (e) {
        logger.error('Create flow wizard save failed:', e)
        const msg = e instanceof Error ? e.message : 'Save failed'
        setError(msg)
        toast.error(msg)
      } finally {
        setSaving(false)
      }
    },
    [form, lambda, onSaved, goTo]
  )

  const currentSupplier = supplierById(lambda)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="יצירת כלל ניתוב"
    >
      {/* Dark glass backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/60"
      >
        {/* Header */}
        <header className="relative shrink-0 overflow-hidden border-b border-white/10">
          <div className="relative flex items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary ring-1 ring-inset ring-white/10">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100">
                  Create a flow rule
                </h2>
                <p className="text-xs text-slate-400">Answer a few simple questions — no code words needed.</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
              aria-label={L.close}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Progress indicator */}
          <div className="relative px-6 pb-4">
            <Stepper
              step={step}
              onJump={goTo}
              canJump={s => s <= step || (s === step + 1 && stepValid(step))}
            />
          </div>
        </header>

        {/* Body */}
        <div className="relative flex-1 overflow-y-auto px-6 py-6">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 0 && (
                <StepPart
                  ref={firstInputRef}
                  value={form.partDescription}
                  suggestions={autocomplete.partDescriptions}
                  onChange={v => set('partDescription', v)}
                  onEnter={next}
                />
              )}
              {step === 1 && (
                <StepSupplier selected={lambda} onSelect={id => set('suppliers', [id])} />
              )}
              {step === 2 && (
                <StepVehicles form={form} set={set} />
              )}
              {step === 3 && (
                <StepMapping
                  form={form}
                  set={set}
                  suggestions={autocomplete}
                  supplierName={currentSupplier.name}
                  onAutoFill={autoFillByPartId}
                  resolving={resolving}
                  resolveMsg={resolveMsg}
                />
              )}
              {step === 4 && (
                <StepReview form={form} lambda={lambda} duplicate={duplicate} />
              )}
            </motion.div>
          </AnimatePresence>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Live preview + footer */}
        <footer className="shrink-0 border-t border-white/10 bg-slate-900/80 backdrop-blur">
          <LivePreview form={form} lambda={lambda} />
          <div className="flex items-center justify-between gap-3 px-6 py-4">
            <button
              onClick={back}
              disabled={step === 0 || saving}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-white/10 px-4 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            {step < 4 ? (
              <button
                onClick={next}
                disabled={saving}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => save('suggestion')}
                  disabled={saving}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save as suggestion
                </button>
                <button
                  onClick={() => save('approved')}
                  disabled={saving}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save &amp; approve
                </button>
              </div>
            )}
          </div>
        </footer>
      </motion.div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Stepper
// ────────────────────────────────────────────────────────────────────────────

function Stepper({
  step,
  onJump,
  canJump,
}: {
  step: StepIndex
  onJump: (i: StepIndex) => void
  canJump: (i: StepIndex) => boolean
}) {
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const Icon = s.icon
        const done = i < step
        const active = i === step
        const reachable = canJump(i as StepIndex)
        return (
          <div key={s.key} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => reachable && onJump(i as StepIndex)}
              disabled={!reachable}
              className="group flex flex-col items-center gap-1.5 disabled:cursor-default"
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={`relative grid h-9 w-9 place-items-center rounded-full border text-sm font-semibold transition-all ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : done
                      ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
                      : 'border-white/15 bg-white/5 text-slate-400'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="step-ring"
                    className="absolute inset-0 rounded-full ring-2 ring-cyan-400/60"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span
                className={`text-[11px] font-medium transition-colors ${
                  active ? 'text-cyan-200' : done ? 'text-emerald-300/80' : 'text-slate-500'
                }`}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div className="mx-1 mb-5 h-0.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full bg-blue-500"
                  initial={false}
                  animate={{ width: i < step ? '100%' : '0%' }}
                  transition={{ duration: 0.35 }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1 — Part
// ────────────────────────────────────────────────────────────────────────────

const StepPart = forwardRef<
  HTMLInputElement,
  { value: string; suggestions: string[]; onChange: (v: string) => void; onEnter: () => void }
>(function StepPart({ value, suggestions, onChange, onEnter }, ref) {
  // We can't easily forward ref into AutocompleteInput, so use a sibling hidden focus
  // strategy: render the input via AutocompleteInput and focus its inner input.
  return (
    <StepShell
      icon={<Package className="h-5 w-5" />}
      title={L.stepPartTitle}
      hint={L.stepPartHint}
    >
      <div
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
          }
        }}
      >
        <div className="[&_input]:h-14 [&_input]:rounded-xl [&_input]:border-white/15 [&_input]:bg-white/5 [&_input]:px-4 [&_input]:text-lg [&_input]:text-slate-100 [&_input]:placeholder:text-slate-500">
          <AutocompleteInput
            id="wizard-part-description"
            value={value}
            onChange={onChange}
            suggestions={suggestions}
            placeholder='e.g. "oil filter" · "מסנן שמן"'
          />
        </div>
        {/* hidden input only to satisfy forwardRef focus contract */}
        <input ref={ref} className="sr-only" aria-hidden tabIndex={-1} onFocus={() => {
          const real = document.getElementById('wizard-part-description') as HTMLInputElement | null
          real?.focus()
        }} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Tip: keep it short and generic. Specific vehicles come in a later step.
      </p>
    </StepShell>
  )
})

// ────────────────────────────────────────────────────────────────────────────
// Step 2 — Supplier
// ────────────────────────────────────────────────────────────────────────────

function StepSupplier({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <StepShell
      icon={<Globe className="h-5 w-5" />}
      title={L.stepSupplierTitle}
      hint={L.stepSupplierHint}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SUPPLIERS.map(s => {
          const isSel = s.id === selected
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-pressed={isSel}
              className={`group relative flex items-start gap-3 overflow-hidden rounded-xl border bg-white/5 p-4 text-left transition-all hover:bg-white/[0.07] ${
                isSel ? `ring-2 ${s.ringSelected}` : 'border-white/10'
              }`}
            >
              <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-xl ${s.iconBg} ${s.iconText}`}>
                <Car className="h-5 w-5" />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">{s.name}</span>
                  {isSel && <CheckCircle2 className={`h-4 w-4 ${s.chip}`} />}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-400">{s.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>
    </StepShell>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Step 3 — Vehicles
// ────────────────────────────────────────────────────────────────────────────

function StepVehicles({
  form,
  set,
}: {
  form: WizardState
  set: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void
}) {
  const specific = form.vehicleScope === 'specific'
  return (
    <StepShell
      icon={<Car className="h-5 w-5" />}
      title={L.stepVehicleTitle}
      hint={L.stepVehicleHint}
    >
      <div className="grid grid-cols-2 gap-3">
        <ScopeCard
          active={!specific}
          onClick={() => set('vehicleScope', 'all')}
          icon={<Globe className="h-6 w-6" />}
          title={L.allVehicles}
          subtitle={L.allVehiclesSub}
        />
        <ScopeCard
          active={specific}
          onClick={() => set('vehicleScope', 'specific')}
          icon={<MapPin className="h-6 w-6" />}
          title={L.specificVehicles}
          subtitle={L.specificVehiclesSub}
        />
      </div>

      <AnimatePresence initial={false}>
        {specific && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-4 grid grid-cols-2 gap-3">
              <DarkField label="משנה">
                <DarkInput type="number" value={form.yearFrom} onChange={v => set('yearFrom', v)} placeholder="2015" />
              </DarkField>
              <DarkField label="עד שנה">
                <DarkInput type="number" value={form.yearTo} onChange={v => set('yearTo', v)} placeholder="2020" />
              </DarkField>
              <DarkField label="דגם">
                <DarkInput value={form.model} onChange={v => set('model', v)} placeholder="208, Corsa…" />
              </DarkField>
              <DarkField label="סוג דלק">
                <DarkInput value={form.fuelType} onChange={v => set('fuelType', v)} placeholder={L.phFuel} />
              </DarkField>
              <DarkField label="דגם מנוע">
                <DarkInput value={form.engineModel} onChange={v => set('engineModel', v)} placeholder={L.optional} />
              </DarkField>
              <DarkField label="תבנית VIN">
                <DarkInput value={form.vinPattern} onChange={v => set('vinPattern', v)} placeholder="WAUZZZ…" mono />
              </DarkField>
            </div>

            <details className="group mt-4 rounded-xl border border-white/10 bg-white/[0.03]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-300">
                <span className="flex items-center gap-2">
                  <Car className="h-4 w-4 text-cyan-300" />
                  Decode a VIN to autofill these fields
                </span>
                <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-3 pb-3">
                <VinDecodeSection
                  defaultCollapsed={false}
                  onVehicleDecoded={v => {
                    if (v?.year) set('yearFrom', String(v.year))
                    if (v?.model) set('model', v.model)
                    if (v?.fuelType) set('fuelType', v.fuelType)
                    if (v?.engineModel) set('engineModel', v.engineModel)
                  }}
                />
              </div>
            </details>
          </motion.div>
        )}
      </AnimatePresence>
    </StepShell>
  )
}

function ScopeCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex flex-col items-start gap-2 overflow-hidden rounded-xl border p-4 text-left transition-all hover:bg-white/[0.07] ${
        active ? 'border-cyan-400/60 bg-cyan-500/10 ring-2 ring-cyan-400/50' : 'border-white/10 bg-white/5'
      }`}
    >
      <span className={`relative grid h-11 w-11 place-items-center rounded-xl ${active ? 'bg-blue-500/20 text-blue-200' : 'bg-white/10 text-slate-300'}`}>
        {icon}
      </span>
      <span className="relative">
        <span className="block text-sm font-semibold text-slate-100">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-400">{subtitle}</span>
      </span>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Step 4 — Catalog mapping
// ────────────────────────────────────────────────────────────────────────────

function StepMapping({
  form,
  set,
  suggestions,
  supplierName,
  onAutoFill,
  resolving,
  resolveMsg,
}: {
  form: WizardState
  set: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void
  suggestions: AutocompleteData
  supplierName: string
  onAutoFill: () => void
  resolving: boolean
  resolveMsg: { kind: 'ok' | 'info' | 'error'; text: string } | null
}) {
  const msgColor =
    resolveMsg?.kind === 'ok' ? 'text-emerald-300'
      : resolveMsg?.kind === 'error' ? 'text-rose-300'
        : 'text-sky-300'
  return (
    <StepShell
      icon={<Layers className="h-5 w-5" />}
      title={L.stepCatalogTitle}
      hint={L.stepCatalogHint(supplierName)}
    >
      <div className="space-y-4">
        {/* Auto-fill by part id: known part → instant; new part → live PSA lookup (needs VIN). */}
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 p-3">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-slate-200">Have the part number? Auto-fill the path</span>
            <span className="text-[11px] text-slate-500">We look it up in {supplierName} for you.</span>
          </div>
          <div className="flex gap-2 [&_input]:h-12 [&_input]:rounded-xl [&_input]:border-white/15 [&_input]:bg-white/5 [&_input]:px-3 [&_input]:text-slate-100 [&_input]:placeholder:text-slate-500">
            <input
              type="text"
              value={form.directPartId}
              onChange={e => set('directPartId', e.target.value)}
              placeholder='Direct part number (מק״ט), e.g. 6466S5'
              className="w-full"
            />
            <button
              type="button"
              onClick={onAutoFill}
              disabled={resolving || !form.directPartId.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Auto-fill by part id
            </button>
          </div>
          <div className="mt-2 [&_input]:h-10 [&_input]:rounded-lg [&_input]:border-white/10 [&_input]:bg-white/5 [&_input]:px-3 [&_input]:text-sm [&_input]:text-slate-100 [&_input]:placeholder:text-slate-500">
            <input
              type="text"
              value={form.lookupVin}
              onChange={e => set('lookupVin', e.target.value)}
              placeholder={L.phLookupVin}
              className="w-full"
            />
          </div>
          {resolveMsg && <p className={`mt-2 text-xs ${msgColor}`}>{resolveMsg.text}</p>}
        </div>

        <WizardAutocompleteField label="קטגוריה" hint={L.hintCategory}>
          <AutocompleteInput
            id="wizard-category"
            value={form.category}
            onChange={v => set('category', v)}
            suggestions={suggestions.categories}
            placeholder={L.phCategory}
          />
        </WizardAutocompleteField>
        <WizardAutocompleteField label="תת-קטגוריה" hint={L.hintSubcategory}>
          <AutocompleteInput
            id="wizard-subcategory"
            value={form.subcategory}
            onChange={v => set('subcategory', v)}
            suggestions={suggestions.subcategories}
            placeholder={L.phSubcategory}
          />
        </WizardAutocompleteField>
        <WizardAutocompleteField label="שרטוט" hint={L.hintSchema}>
          <AutocompleteInput
            id="wizard-schema"
            value={form.schema}
            onChange={v => set('schema', v)}
            suggestions={suggestions.schemas}
            placeholder={L.phSchema}
          />
        </WizardAutocompleteField>
        <WizardAutocompleteField label={L.partNameInSchema} hint={L.hintPartName}>
          <input
            type="text"
            value={form.directPartName}
            onChange={e => set('directPartName', e.target.value)}
            placeholder={L.phPartName}
            className="w-full"
          />
        </WizardAutocompleteField>
      </div>
    </StepShell>
  )
}

function WizardAutocompleteField({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-200">{label}</span>
        <span className="text-[11px] text-slate-500">{hint}</span>
      </div>
      <div className="[&_input]:h-12 [&_input]:rounded-xl [&_input]:border-white/15 [&_input]:bg-white/5 [&_input]:px-3 [&_input]:text-slate-100 [&_input]:placeholder:text-slate-500">
        {children}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Step 5 — Review & test
// ────────────────────────────────────────────────────────────────────────────

function dupNorm(s?: string | null): string {
  return (s ?? '').trim().toLowerCase().normalize('NFC')
}

function ruleHasNoVehicle(r: FlowDecisionRecord): boolean {
  return !r.vehicleYearFrom && !r.vehicleYearTo && !r.vehicleModel &&
    !r.vehicleFuelType && !r.vehicleEngineModel && !r.vinPattern
}

// Finds an existing rule that would collide with what the wizard is about to
// create (same part description + supplier + vehicle scope), mirroring the DB
// unique constraint so the operator is warned before saving.
function findDuplicateRule(rules: FlowDecisionRecord[], form: WizardState, lambda: string): FlowDecisionRecord | null {
  const part = dupNorm(form.partDescription)
  if (!part) return null
  const yf = form.yearFrom && !isNaN(parseInt(form.yearFrom)) ? parseInt(form.yearFrom) : null
  const yt = form.yearTo && !isNaN(parseInt(form.yearTo)) ? parseInt(form.yearTo) : null
  return (
    rules.find(r => {
      if (dupNorm(r.partDescription) !== part) return false
      if (r.lambdaTarget !== lambda) return false
      if (form.vehicleScope === 'all') return ruleHasNoVehicle(r)
      return (
        (r.vehicleYearFrom ?? null) === yf &&
        (r.vehicleYearTo ?? null) === yt &&
        dupNorm(r.vehicleModel) === dupNorm(form.model) &&
        dupNorm(r.vehicleFuelType) === dupNorm(form.fuelType) &&
        dupNorm(r.vehicleEngineModel) === dupNorm(form.engineModel) &&
        dupNorm(r.vinPattern) === dupNorm(form.vinPattern)
      )
    }) ?? null
  )
}

function StepReview({ form, lambda, duplicate }: { form: WizardState; lambda: string; duplicate: FlowDecisionRecord | null }) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<SimulateResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const supplier = supplierById(lambda)

  const runTest = useCallback(async () => {
    setTesting(true)
    setTestError(null)
    setResult(null)
    try {
      const body: Record<string, unknown> = { partDescription: form.partDescription.trim() }
      if (form.vehicleScope === 'specific') {
        if (form.model) body.vehicleModel = form.model
        if (form.yearFrom) body.year = parseInt(form.yearFrom)
        if (form.fuelType) body.fuelType = form.fuelType
        if (form.engineModel) body.engineModel = form.engineModel
        if (form.vinPattern) body.vin = form.vinPattern
      }
      const res = await fetch('/api/flow-decisions/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Simulation failed')
      }
      setResult(await res.json())
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setTesting(false)
    }
  }, [form])

  const match = result?.bestMatch

  return (
    <StepShell
      icon={<FlaskConical className="h-5 w-5" />}
      title={L.stepReviewTitle}
      hint={L.stepReviewHint}
    >
      {/* Big rule sentence */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-800/60 p-5">
        <RuleSentence form={form} lambda={lambda} large />
      </div>

      {/* Duplicate / conflict warning */}
      {duplicate && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="text-amber-100">
            <p className="font-semibold text-amber-200">{L.duplicateExists}</p>
            <p className="mt-0.5 text-amber-100/80">
              “{duplicate.partDescription}” → {duplicate.lambdaTarget} with the same vehicle scope is already
              {' '}<span className="font-medium">{duplicate.status}</span>. Saving will conflict — edit the existing rule instead.
            </p>
          </div>
        </div>
      )}

      {/* Summary card */}
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <SummaryRow label={L.colPart} value={form.partDescription || '—'} />
        <SummaryRow label={L.supplier} value={supplier.name} />
        <SummaryRow label="קטגוריה" value={form.category || '—'} />
        <SummaryRow label="תת-קטגוריה" value={form.subcategory || '—'} />
        <SummaryRow label="שרטוט" value={form.schema || '—'} />
        <SummaryRow label={L.vehicles} value={vehicleSummary(form)} />
      </div>

      {/* Test */}
      <div className="mt-5">
        <button
          type="button"
          onClick={runTest}
          disabled={testing || !form.partDescription.trim()}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          Test it
        </button>

        <AnimatePresence>
          {testError && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {testError}
            </motion.div>
          )}
          {match && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-200">
                <CheckCircle2 className="h-4 w-4" />
                Best match
                {typeof match.confidence === 'number' && (
                  <span className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-100">
                    {Math.round(match.confidence * 100)}% confidence
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-200">
                <Pill>{match.category || '—'}</Pill>
                <span className="text-slate-500">›</span>
                <Pill>{match.subcategory || '—'}</Pill>
                <span className="text-slate-500">›</span>
                <Pill>{match.schema || '—'}</Pill>
              </div>
              {match.reasoning && (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{match.reasoning}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </StepShell>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="truncate text-sm font-medium text-slate-100" title={value} dir="auto">
        {value}
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-white/10 px-2 py-0.5 font-medium text-slate-100">{children}</span>
}

// ────────────────────────────────────────────────────────────────────────────
// Live preview (persistent across steps)
// ────────────────────────────────────────────────────────────────────────────

function LivePreview({ form, lambda }: { form: WizardState; lambda: string }) {
  return (
    <div className="border-b border-white/5 bg-white/[0.03] px-6 py-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <RuleSentence form={form} lambda={lambda} />
      </div>
    </div>
  )
}

function RuleSentence({ form, lambda, large }: { form: WizardState; lambda: string; large?: boolean }) {
  const supplier = supplierById(lambda)
  const part = form.partDescription.trim()
  const veh = vehicleSummary(form)
  const base = large ? 'text-base leading-relaxed text-slate-200' : 'text-sm leading-snug text-slate-300'
  return (
    <p className={base}>
      When a customer asks for{' '}
      <strong className="font-semibold text-cyan-200" dir="auto">
        {part ? `"${part}"` : '…'}
      </strong>
      , search{' '}
      <strong className={`font-semibold ${supplier.chip}`}>{supplier.name}</strong> for{' '}
      <strong className="font-semibold text-slate-100" dir="auto">
        {veh}
      </strong>
      .
      {form.category && form.subcategory && form.schema && (
        <>
          {' '}
          <span className="text-slate-400">Catalog path: </span>
          <span className="font-medium text-slate-200">
            {form.category} › {form.subcategory} › {form.schema}
          </span>
          .
        </>
      )}
      {form.directPartId.trim() && (
        <>
          {' '}
          <span className="text-slate-400">Pinned part: </span>
          <span className="font-medium text-emerald-200" dir="auto">
            {form.directPartId.trim()}
            {form.directPartName.trim() && ` (${form.directPartName.trim()})`}
          </span>
          .
        </>
      )}
    </p>
  )
}

function vehicleSummary(form: WizardState): string {
  if (form.vehicleScope === 'all') return 'all vehicles'
  const parts: string[] = []
  if (form.model) parts.push(form.model)
  if (form.yearFrom && form.yearTo) parts.push(`${form.yearFrom}–${form.yearTo}`)
  else if (form.yearFrom) parts.push(`from ${form.yearFrom}`)
  else if (form.yearTo) parts.push(`until ${form.yearTo}`)
  if (form.fuelType) parts.push(form.fuelType)
  if (form.engineModel) parts.push(form.engineModel)
  return parts.length ? parts.join(', ') : 'specific vehicles'
}

// ────────────────────────────────────────────────────────────────────────────
// Shared shell + dark form primitives
// ────────────────────────────────────────────────────────────────────────────

function StepShell({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-5 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-cyan-300 ring-1 ring-inset ring-white/10">
          {icon}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          <p className="mt-0.5 text-sm text-slate-400">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function DarkField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}

function DarkInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  mono?: boolean
}) {
  return (
    <input
      type={type}
      inputMode={type === 'number' ? 'numeric' : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      dir="auto"
      className={`h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none focus:ring-2 focus:ring-ring ${
        mono ? 'font-mono tracking-wider' : ''
      }`}
    />
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const stepVariants = {
  enter: (dir: 1 | -1) => ({ opacity: 0, x: dir * 40 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: 1 | -1) => ({ opacity: 0, x: dir * -40 }),
}

function stepErrorMessage(s: StepIndex): string {
  switch (s) {
    case 0:
      return 'Please tell us which part the customer is asking for.'
    case 1:
      return 'Please choose a supplier.'
    case 3:
      return 'Catalog mapping is required: fill category, subcategory and schema.'
    default:
      return 'Please complete this step.'
  }
}

function buildVehicleFilters(form: WizardState) {
  if (form.vehicleScope === 'all') return undefined
  const out: Record<string, unknown> = {}
  if (form.yearFrom) out.yearFrom = parseInt(form.yearFrom)
  if (form.yearTo) out.yearTo = parseInt(form.yearTo)
  if (form.model) out.model = form.model
  if (form.fuelType) out.fuelType = form.fuelType
  if (form.engineModel) out.engineModel = form.engineModel
  if (form.vinPattern) out.vinPattern = form.vinPattern
  return Object.keys(out).length ? out : undefined
}
