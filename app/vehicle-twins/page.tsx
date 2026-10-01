'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Car, History, Loader2, Pencil, Plus, Ruler, ScanSearch, Search, Trash2, TriangleAlert, X,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { Segmented } from '@/components/shared/filter-controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  CONFIDENCES, CONFIDENCE_LABEL, EMPTY_FORM, POWERTRAINS, POWERTRAIN_LABEL, RELATIONS, RELATION_LABEL,
  distinctBrands, filterTwins, formToPayload, formatYears, listOf, overlapPercent, twinToForm, validateForm,
  type Confidence, type Relation, type TwinForm, type TwinLogEntry, type VehicleTwin,
} from '@/lib/vehicle-twins'
import {
  TwinApiError, useDeleteTwin, useMeasureTwin, useSaveTwin, useTwinDetail, useVehicleTwins, useVinLookup,
} from '@/hooks/use-vehicle-twins'

const SELECT_CLS =
  'h-9 pointer-coarse:h-11 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const shortUser = (e: string | null | undefined) => (e ? e.replace(/@jan\.co\.il$/i, '') : '')

function RelationBadge({ relation }: { relation: Relation }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
        relation === 'rebadge' ? 'bg-success-subtle text-success-subtle-foreground' : 'bg-info-subtle text-info-subtle-foreground',
      )}
      title={relation}
    >
      {RELATION_LABEL[relation] ?? relation}
    </span>
  )
}

function ConfidenceBadge({ value }: { value: Confidence | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs',
        value === 'high' && 'bg-success-subtle text-success-subtle-foreground',
        value === 'medium' && 'bg-warning-subtle text-warning-subtle-foreground',
        value === 'low' && 'bg-destructive/10 text-destructive',
      )}
    >
      {CONFIDENCE_LABEL[value] ?? value}
    </span>
  )
}

function Overlap({ v }: { v: VehicleTwin['overlap_pct'] }) {
  const pct = overlapPercent(v)
  if (pct == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('tabular-nums', pct >= 80 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-destructive')}>
      {pct}%
    </span>
  )
}

function ErrorList({ error }: { error: unknown }) {
  if (!error) return null
  const lines = error instanceof TwinApiError ? error.lines : [error instanceof Error ? error.message : String(error)]
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
      <ul className="list-inside list-disc space-y-0.5">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  )
}

function Json({ value }: { value: unknown }) {
  if (value == null) return null
  return (
    <pre dir="ltr" className="max-h-64 overflow-auto rounded bg-muted p-2 text-start text-[11px] leading-snug">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

// ---------------------------------------------------------------------------
// VIN check

function VinCheck() {
  const [vin, setVin] = useState('')
  const lookup = useVinLookup()
  const r = lookup.data
  const project = r?.project as Record<string, unknown> | null | undefined
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={e => { e.preventDefault(); if (vin.trim()) lookup.mutate(vin) }}
      >
        <ScanSearch className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">בדיקת VIN</span>
        <Input
          dir="ltr"
          value={vin}
          onChange={e => setVin(e.target.value.toUpperCase())}
          placeholder="VF3…"
          maxLength={17}
          className="w-full max-w-xs font-mono sm:w-64"
          aria-label="VIN"
        />
        <Button type="submit" size="sm" disabled={!vin.trim() || lookup.isPending}>
          {lookup.isPending ? <Loader2 className="animate-spin" /> : <Search />}
          בדוק
        </Button>
      </form>
      {lookup.error && <div className="mt-2"><ErrorList error={lookup.error} /></div>}
      {r && (
        <div className="mt-3 space-y-2 text-sm">
          {r.twin ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-muted-foreground">יענה מ:</span>
              <span className="font-medium">{r.twin.twin_brand} {r.twin.twin_model}</span>
              <RelationBadge relation={r.twin.relation} />
              {r.twin.twin_catalogue_ref && <span dir="ltr" className="font-mono text-xs">{r.twin.twin_catalogue_ref}</span>}
              <span className="text-muted-foreground">
                (רשומה #{r.twin.id}: {r.twin.brand} {r.twin.model} {formatYears(r.twin.year_from, r.twin.year_to)})
              </span>
              {r.matched_by && <span className="text-xs text-muted-foreground">התאמה לפי: {r.matched_by}</span>}
            </div>
          ) : (
            <div className="text-muted-foreground">אין תאום לרכב הזה — דיאגו יענה מהקטלוג של הרכב עצמו (אם נסרק).</div>
          )}
          {project ? (
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>פרויקט:</span>
              <span dir="ltr" className="font-mono">
                {String(project.id ?? project.project_id ?? '')} {String(project.vin ?? '')}
              </span>
              <span>{[project.make, project.model, project.year].filter(Boolean).map(String).join(' ')}</span>
            </div>
          ) : r.twin ? (
            <div className="text-xs text-warning">לא נמצא פרויקט סרוק לתאום.</div>
          ) : null}
          {r.subject && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">פרטי הרכב שזוהה</summary>
              <Json value={r.subject} />
            </details>
          )}
          {r.alternatives?.length > 0 && (
            <div className="text-xs text-muted-foreground">
              חלופות: {r.alternatives.map(a => `#${a.id} ${a.twin_brand} ${a.twin_model}`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create / edit

function Field({ label, required, hint, children, wide }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode; wide?: boolean
}) {
  return (
    <label className={cn('flex flex-col gap-1 text-xs', wide && 'sm:col-span-2')}>
      <span className="font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
    </label>
  )
}

function TwinEditor({ twin, onClose }: { twin: VehicleTwin | 'new'; onClose: () => void }) {
  const isNew = twin === 'new'
  const [form, setForm] = useState<TwinForm>(isNew ? EMPTY_FORM : twinToForm(twin))
  const [localErrors, setLocalErrors] = useState<string[]>([])
  const save = useSaveTwin()
  const set = (k: keyof TwinForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validateForm(form)
    setLocalErrors(errs)
    if (errs.length) return
    save.mutate({ id: isNew ? null : twin.id, payload: formToPayload(form) }, { onSuccess: onClose })
  }

  const text = (k: keyof TwinForm, opts: { ltr?: boolean; placeholder?: string } = {}) => (
    <Input value={form[k]} onChange={set(k)} dir={opts.ltr ? 'ltr' : undefined} placeholder={opts.placeholder} />
  )

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>{isNew ? 'תאום חדש' : `עריכת תאום #${twin.id}`}</DialogTitle>
          <DialogDescription>שינויים כאן משפיעים מיד על התשובות של דיאגו (עד דקה)</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">הרכב בישראל</legend>
            <Field label="יצרן" required>{text('brand', { placeholder: 'Fiat' })}</Field>
            <Field label="דגם" required>{text('model', { placeholder: 'Doblo' })}</Field>
            <Field label="שנה מ־">{text('year_from', { ltr: true, placeholder: '2022' })}</Field>
            <Field label="שנה עד">{text('year_to', { ltr: true, placeholder: '2025' })}</Field>
            <Field label="הנעה">
              <select className={SELECT_CLS} value={form.powertrain} onChange={set('powertrain')}>
                <option value="">— כל סוג —</option>
                {POWERTRAINS.map(p => <option key={p} value={p}>{POWERTRAIN_LABEL[p]} ({p})</option>)}
              </select>
            </Field>
            <Field label="שוק">{text('market', { ltr: true, placeholder: 'IL' })}</Field>
            <Field label="קודי דגם" hint="מופרדים בפסיק">{text('model_codes', { ltr: true })}</Field>
            <Field label="קידומות VIN" hint="מופרדות בפסיק, למשל ZFA263">{text('vin_prefixes', { ltr: true })}</Field>
            <Field label="תבנית VIN (regex)" wide>{text('vin_pattern', { ltr: true })}</Field>
          </fieldset>
          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">התאום (הקטלוג שעונה)</legend>
            <Field label="יצרן תאום" required>{text('twin_brand', { placeholder: 'Citroen' })}</Field>
            <Field label="דגם תאום" required>{text('twin_model', { placeholder: 'Berlingo' })}</Field>
            <Field label="קטלוג">{text('twin_catalogue', { ltr: true, placeholder: 'PSA' })}</Field>
            <Field label="מזהה בקטלוג">{text('twin_catalogue_ref', { ltr: true })}</Field>
            <Field label="קידומות VIN של התאום">{text('twin_vin_prefixes', { ltr: true })}</Field>
            <Field label="פרויקט Partly של התאום">{text('twin_project_id', { ltr: true })}</Field>
          </fieldset>
          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">הקשר</legend>
            <Field label="סוג קשר" required>
              <select className={SELECT_CLS} value={form.relation} onChange={set('relation')}>
                {RELATIONS.map(r => <option key={r} value={r}>{RELATION_LABEL[r]} ({r})</option>)}
              </select>
            </Field>
            <Field label="רמת ביטחון">
              <select className={SELECT_CLS} value={form.confidence} onChange={set('confidence')}>
                <option value="">—</option>
                {CONFIDENCES.map(c => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field label="מקור" required wide hint="מאיפה המידע: מסמך יצרן, מדידת חפיפה, ידע מקצועי…">
              {text('source', { placeholder: 'manual' })}
            </Field>
            <Field label="הערות" wide>
              <textarea
                value={form.notes}
                onChange={set('notes')}
                rows={2}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </Field>
          </fieldset>
          {localErrors.length > 0 && <ErrorList error={new TwinApiError(400, localErrors)} />}
          <ErrorList error={save.error} />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {isNew ? 'צור' : 'שמור'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Delete / measure / history

function DeleteConfirm({ twin, onClose }: { twin: VehicleTwin; onClose: () => void }) {
  const del = useDeleteTwin()
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent dir="rtl">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>למחוק את התאום #{twin.id}?</DialogTitle>
          <DialogDescription>
            {twin.brand} {twin.model} {formatYears(twin.year_from, twin.year_to)} ← {twin.twin_brand} {twin.twin_model}.
            {' '}דיאגו יפסיק להשתמש בו תוך דקה.
          </DialogDescription>
        </DialogHeader>
        <ErrorList error={del.error} />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate(twin.id, { onSuccess: onClose })}>
            {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            מחק
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MeasureDialog({ twin, onClose }: { twin: VehicleTwin; onClose: () => void }) {
  const measure = useMeasureTwin()
  const { mutate } = measure
  // Opening the dialog IS the request; the ref keeps StrictMode's double effect to one measure.
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    mutate(twin.id)
  }, [mutate, twin.id])
  const d = measure.data
  const pct = d ? overlapPercent(d.twin?.overlap_pct ?? (d.overlap?.overlap_pct as number | undefined) ?? null) : null
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>מדידת חפיפה — #{twin.id}</DialogTitle>
          <DialogDescription>{twin.brand} {twin.model} מול {twin.twin_brand} {twin.twin_model}</DialogDescription>
        </DialogHeader>
        {measure.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> משווה את שני הקטלוגים…
          </div>
        )}
        <ErrorList error={measure.error} />
        {d && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-muted-foreground">חפיפה:</span>
              <span className="text-2xl font-bold"><Overlap v={pct} /></span>
              {d.twin?.confidence && <ConfidenceBadge value={d.twin.confidence} />}
            </div>
            {d.decision != null && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">החלטה</div>
                {typeof d.decision === 'string' ? <div>{d.decision}</div> : <Json value={d.decision} />}
              </div>
            )}
            {d.overlap && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">פירוט המדידה</summary>
                <Json value={d.overlap} />
              </details>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>סגור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function logWhen(e: TwinLogEntry) { return fmtDate((e.created_at ?? e.at ?? null) as string | null) }
function logWho(e: TwinLogEntry) { return shortUser((e.actor ?? e.changed_by ?? e.acting_user ?? e.user ?? null) as string | null) }

function HistoryDialog({ twin, onClose }: { twin: VehicleTwin; onClose: () => void }) {
  const q = useTwinDetail(twin.id)
  const log = q.data?.log ?? []
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>היסטוריה — #{twin.id}</DialogTitle>
          <DialogDescription>{twin.brand} {twin.model} ← {twin.twin_brand} {twin.twin_model}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>}
        <ErrorList error={q.error} />
        {q.data && log.length === 0 && <div className="text-sm text-muted-foreground">אין רישומים.</div>}
        <ol className="space-y-2">
          {log.map((e, i) => {
            const { before, after, diff } = e
            return (
              <li key={String(e.id ?? i)} className="rounded-md border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 text-xs">
                  <span className="font-semibold">{String(e.action ?? 'שינוי')}</span>
                  <span className="text-muted-foreground">{logWho(e)}</span>
                  <span className="tabular-nums text-muted-foreground">{logWhen(e)}</span>
                </div>
                {(diff ?? after ?? before) != null && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground">פרטים</summary>
                    <Json value={diff ?? { before, after }} />
                  </details>
                )}
              </li>
            )
          })}
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>סגור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Page

type Modal =
  | { kind: 'edit'; twin: VehicleTwin | 'new' }
  | { kind: 'delete' | 'measure' | 'history'; twin: VehicleTwin }
  | null

export default function VehicleTwinsPage() {
  const list = useVehicleTwins()
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState<string>('')
  const [relation, setRelation] = useState<Relation | null>(null)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [modal, setModal] = useState<Modal>(null)

  const canEdit = !!list.data?.viewer?.canEdit
  const all = useMemo(() => list.data?.twins ?? [], [list.data])
  const brands = useMemo(() => distinctBrands(all), [all])
  const rows = useMemo(
    () => filterTwins(all, { q, brand: brand || null, relation, confidence }),
    [all, q, brand, relation, confidence],
  )
  const filtered = q || brand || relation || confidence

  const actions = (t: VehicleTwin) => (
    <div className="flex items-center justify-end gap-0.5">
      <Button variant="ghost" size="icon" className="h-7 w-7" title="היסטוריה" aria-label="היסטוריה" onClick={() => setModal({ kind: 'history', twin: t })}>
        <History />
      </Button>
      {canEdit && (
        <>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="מדוד חפיפה" onClick={() => setModal({ kind: 'measure', twin: t })}>
            <Ruler /> מדוד חפיפה
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="עריכה" aria-label="עריכה" onClick={() => setModal({ kind: 'edit', twin: t })}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="מחיקה" aria-label="מחיקה" onClick={() => setModal({ kind: 'delete', twin: t })}>
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  )

  const vehicle = (t: VehicleTwin) => (
    <div className="min-w-0">
      <div className="font-medium">{t.brand} {t.model}</div>
      {listOf(t.vin_prefixes).length > 0 && (
        <div dir="ltr" className="truncate text-start font-mono text-[11px] text-muted-foreground">{listOf(t.vin_prefixes).join(' ')}</div>
      )}
    </div>
  )
  const twinCell = (t: VehicleTwin) => (
    <div className="min-w-0">
      <div className="font-medium">{t.twin_brand} {t.twin_model}</div>
      {(t.twin_catalogue || t.twin_catalogue_ref) && (
        <div dir="ltr" className="truncate text-start font-mono text-[11px] text-muted-foreground">
          {[t.twin_catalogue, t.twin_catalogue_ref].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  )
  const updated = (t: VehicleTwin) => (
    <div className="text-xs leading-tight">
      <div>{shortUser(t.updated_by ?? t.created_by)}</div>
      <div className="tabular-nums text-muted-foreground">{fmtDate(t.updated_at ?? t.created_at)}</div>
    </div>
  )

  const columns: DataTableColumn<VehicleTwin>[] = [
    { key: 'id', header: '#', cell: t => <span className="tabular-nums text-muted-foreground">{t.id}</span>, sortable: true, exportValue: t => Number(t.id) || String(t.id) },
    { key: 'brand', header: 'רכב בישראל', cell: vehicle, sortable: true, sortValue: t => `${t.brand} ${t.model}`, exportValue: t => `${t.brand} ${t.model}` },
    { key: 'year_from', header: 'שנים', cell: t => <span className="whitespace-nowrap tabular-nums">{formatYears(t.year_from, t.year_to) || '—'}</span>, sortable: true, exportValue: t => formatYears(t.year_from, t.year_to) },
    { key: 'powertrain', header: 'הנעה', cell: t => (t.powertrain ? POWERTRAIN_LABEL[t.powertrain as keyof typeof POWERTRAIN_LABEL] ?? t.powertrain : '—'), sortable: true, exportValue: t => t.powertrain ?? '' },
    { key: 'twin_brand', header: 'תאום', cell: twinCell, sortable: true, sortValue: t => `${t.twin_brand} ${t.twin_model}`, exportValue: t => `${t.twin_brand} ${t.twin_model} ${t.twin_catalogue_ref ?? ''}`.trim() },
    { key: 'relation', header: 'קשר', cell: t => <RelationBadge relation={t.relation} />, sortable: true, exportValue: t => RELATION_LABEL[t.relation] ?? t.relation },
    { key: 'overlap_pct', header: 'חפיפה', align: 'end', cell: t => <Overlap v={t.overlap_pct} />, sortable: true, sortValue: t => overlapPercent(t.overlap_pct), exportValue: t => overlapPercent(t.overlap_pct) },
    { key: 'confidence', header: 'ביטחון', cell: t => <ConfidenceBadge value={t.confidence} />, sortable: true, sortValue: t => (t.confidence ? CONFIDENCES.indexOf(t.confidence) : 9), exportValue: t => t.confidence ?? '' },
    { key: 'source', header: 'מקור', cell: t => t.source, truncate: 'max-w-[140px]', title: t => [t.source, t.notes].filter(Boolean).join(' — '), sortable: true },
    { key: 'updated_at', header: 'עודכן', cell: updated, sortable: true, sortValue: t => t.updated_at ?? t.created_at, exportValue: t => `${t.updated_by ?? ''} ${t.updated_at ?? ''}`.trim() },
    { key: 'actions', header: '', cell: actions, exportValue: null, cellClassName: 'w-px whitespace-nowrap' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="רכבים תאומים"
        icon={Car}
        description="איזה קטלוג עונה על רכב ישראלי: אותו רכב בתג אחר, או פלטפורמה משותפת"
        actions={canEdit ? (
          <Button size="sm" onClick={() => setModal({ kind: 'edit', twin: 'new' })}>
            <Plus /> תאום חדש
          </Button>
        ) : undefined}
      />

      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>שינויים כאן משפיעים מיד על התשובות של דיאגו (עד דקה)</span>
      </div>

      {list.data && !canEdit && (
        <div className="text-xs text-muted-foreground">
          צפייה בלבד{list.data.viewer?.email ? ` (${list.data.viewer.email})` : ''} — עריכה מותרת למנהלים בלבד.
        </div>
      )}

      <VinCheck />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש יצרן, דגם, קטלוג, VIN…" className="ps-8" aria-label="חיפוש" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="נקה" className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">יצרן</span>
          <select className={SELECT_CLS} value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="">הכל</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <Segmented
          label="קשר"
          value={relation}
          onChange={setRelation}
          options={[{ value: null, label: 'הכל' }, ...RELATIONS.map(r => ({ value: r, label: RELATION_LABEL[r] }))]}
        />
        <Segmented
          label="ביטחון"
          value={confidence}
          onChange={setConfidence}
          options={[{ value: null, label: 'הכל' }, ...CONFIDENCES.map(c => ({ value: c, label: CONFIDENCE_LABEL[c] }))]}
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          {filtered ? `${rows.length} מתוך ${all.length}` : `${all.length} רשומות`}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={t => String(t.id)}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        defaultSort={{ field: 'brand', dir: 'asc' }}
        minWidth="min-w-[1100px]"
        pageSize={50}
        exportFileName="vehicle-twins"
        mobileCard={{
          title: t => `${t.brand} ${t.model} ${formatYears(t.year_from, t.year_to)}`.trim(),
          subtitle: t => <span>← {t.twin_brand} {t.twin_model}{t.twin_catalogue_ref ? ` · ${t.twin_catalogue_ref}` : ''}</span>,
          accent: t => <Overlap v={t.overlap_pct} />,
          fields: [
            { label: 'קשר', value: t => <RelationBadge relation={t.relation} /> },
            { label: 'ביטחון', value: t => <ConfidenceBadge value={t.confidence} /> },
            { label: 'מקור', value: t => t.source },
            { label: 'עודכן', value: t => `${shortUser(t.updated_by ?? t.created_by)} ${fmtDate(t.updated_at ?? t.created_at)}` },
            { label: 'פעולות', value: actions },
          ],
        }}
        labels={{ empty: filtered ? 'אין תאומים שתואמים לסינון' : 'אין עדיין תאומים' }}
      />

      {modal?.kind === 'edit' && <TwinEditor key={String(modal.twin === 'new' ? 'new' : modal.twin.id)} twin={modal.twin} onClose={() => setModal(null)} />}
      {modal?.kind === 'delete' && <DeleteConfirm twin={modal.twin} onClose={() => setModal(null)} />}
      {modal?.kind === 'measure' && <MeasureDialog twin={modal.twin} onClose={() => setModal(null)} />}
      {modal?.kind === 'history' && <HistoryDialog twin={modal.twin} onClose={() => setModal(null)} />}
    </div>
  )
}
