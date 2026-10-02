'use client'

import { useMemo, useState } from 'react'
import { Ban, History, Loader2, Pencil, Plus, ScanSearch, Search, Trash2, TriangleAlert, X } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { Segmented } from '@/components/shared/filter-controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  BLOCKLIST_PROVIDERS, EMPTY_BLOCKLIST_FORM, PROVIDER_LABEL, SERVING_PROVIDERS,
  blockingProviders, changedFields, entryToForm, filterEntries, formToPayload, normalizePrefix, validateBlocklistForm,
  type BlocklistEntry, type BlocklistForm, type BlocklistLogEntry, type BlocklistProvider,
} from '@/lib/vehicle-blocklist'
import {
  BlocklistApiError, useBlocklistDetail, useBlocklistVinTest, useDeleteBlocklistEntry, useSaveBlocklistEntry,
  useVehicleBlocklist,
} from '@/hooks/use-vehicle-blocklist'

const SELECT_CLS =
  'h-9 pointer-coarse:h-11 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const pad2 = (n: number) => String(n).padStart(2, '0')

// Built by hand rather than toLocaleString('he-IL') — see the twins page: the bidi
// algorithm scrambles "20:07 ,01.10.26" in an RTL cell.
function fmtDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`
  return withTime ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date
}

// Humans are emails; seeds write "seed:scripts/add-vehicle-blocklist.ts" — keep the file stem.
const shortUser = (e: string | null | undefined) =>
  e ? e.replace(/@jan\.co\.il$/i, '').replace(/^\w+:(?:.*\/)?([^/]+?)(?:\.\w+)?$/, '$1') : ''

function ProviderBadge({ provider }: { provider: BlocklistProvider }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
        provider === 'all' ? 'bg-destructive/10 text-destructive' : 'bg-info-subtle text-info-subtle-foreground',
      )}
      title={provider}
    >
      {PROVIDER_LABEL[provider] ?? provider}
    </span>
  )
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs',
        active ? 'bg-success-subtle text-success-subtle-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {active ? 'פעיל' : 'מושבת'}
    </span>
  )
}

function ErrorList({ error }: { error: unknown }) {
  if (!error) return null
  const lines = error instanceof BlocklistApiError ? error.lines : [error instanceof Error ? error.message : String(error)]
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
  const test = useBlocklistVinTest()
  const r = test.data
  const blocking = r ? blockingProviders(r) : []
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={e => { e.preventDefault(); if (vin.trim()) test.mutate(vin) }}
      >
        <ScanSearch className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">בדיקת VIN</span>
        <Input
          dir="ltr"
          value={vin}
          onChange={e => setVin(e.target.value.toUpperCase())}
          placeholder="LSJWT…"
          maxLength={17}
          className="w-full max-w-xs font-mono sm:w-64"
          aria-label="VIN"
        />
        <Button type="submit" size="sm" disabled={vin.trim().length < 3 || test.isPending}>
          {test.isPending ? <Loader2 className="animate-spin" /> : <Search />}
          בדוק
        </Button>
      </form>
      {test.error && <div className="mt-2"><ErrorList error={test.error} /></div>}
      {r && (
        <div className="mt-3 space-y-2 text-sm">
          <div className={cn('font-medium', blocking.length ? 'text-destructive' : 'text-success')}>
            {blocking.length === 0
              ? 'לא חסום — כל הספקים יסרקו/ייבאו את הרכב הזה.'
              : blocking.length === SERVING_PROVIDERS.length
                ? 'חסום אצל כל הספקים.'
                : `חסום אצל ${blocking.length} מתוך ${SERVING_PROVIDERS.length} ספקים.`}
          </div>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {SERVING_PROVIDERS.map(p => {
              const e = r.providers[p] ?? null
              return (
                <li key={p} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1">
                  <span className="w-24 shrink-0 text-xs font-medium">{PROVIDER_LABEL[p]}</span>
                  {e ? (
                    <>
                      <span className="text-xs text-destructive">חסום</span>
                      <span dir="ltr" className="font-mono text-xs">{e.vin_prefix}</span>
                      {e.provider === 'all' && <span className="text-[11px] text-muted-foreground">(כל הספקים)</span>}
                      <span className="w-full truncate text-[11px] text-muted-foreground" title={e.reason}>{e.reason}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">פתוח</span>
                  )}
                </li>
              )
            })}
          </ul>
          {r.fallback && (
            <div className="text-xs text-warning">
              Partly לא הצליח לקרוא את הטבלה וענה מרשימת הגיבוי (IM Motors בלבד).
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

function EntryEditor({ entry, onClose }: { entry: BlocklistEntry | 'new'; onClose: () => void }) {
  const isNew = entry === 'new'
  const [form, setForm] = useState<BlocklistForm>(isNew ? EMPTY_BLOCKLIST_FORM : entryToForm(entry))
  const [localErrors, setLocalErrors] = useState<string[]>([])
  const save = useSaveBlocklistEntry()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validateBlocklistForm(form)
    setLocalErrors(errs)
    if (errs.length) return
    if (isNew) {
      save.mutate({ id: null, payload: formToPayload(form) }, { onSuccess: onClose })
      return
    }
    const patch = changedFields(entry, form)
    if (!Object.keys(patch).length) { onClose(); return }
    save.mutate({ id: entry.id, payload: patch }, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>{isNew ? 'חסימה חדשה' : `עריכת חסימה ${entry.vin_prefix}`}</DialogTitle>
          <DialogDescription>Partly יפסיק לסרוק ולייבא רכבים שה־VIN שלהם מתחיל בקידומת (עד דקה)</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="קידומת VIN" required hint="3–17 תווים, למשל LSJWT">
              <Input
                dir="ltr"
                className="font-mono"
                value={form.vin_prefix}
                maxLength={20}
                onChange={e => setForm(f => ({ ...f, vin_prefix: normalizePrefix(e.target.value) }))}
                placeholder="LSJWT"
              />
            </Field>
            <Field label="ספק" required hint="'כל הספקים' חוסם סריקה וייבוא מכל מקור">
              <select
                className={SELECT_CLS}
                value={form.provider}
                onChange={e => setForm(f => ({ ...f, provider: e.target.value as BlocklistProvider }))}
              >
                {BLOCKLIST_PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field label="סיבה" required wide>
              <textarea
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                rows={3}
                maxLength={500}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
              />
              פעיל (כשמבוטל — השורה נשמרת אבל לא חוסמת)
            </label>
          </div>
          {localErrors.length > 0 && <ErrorList error={new BlocklistApiError(400, localErrors)} />}
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
// Delete / history

function DeleteConfirm({ entry, onClose }: { entry: BlocklistEntry; onClose: () => void }) {
  const del = useDeleteBlocklistEntry()
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent dir="rtl">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>למחוק את החסימה {entry.vin_prefix}?</DialogTitle>
          <DialogDescription>
            {PROVIDER_LABEL[entry.provider]} — {entry.reason}.
            {' '}רכבים עם הקידומת הזו ייסרקו וייובאו שוב תוך דקה. כדי להשהות בלי למחוק — ערוך ובטל &quot;פעיל&quot;.
          </DialogDescription>
        </DialogHeader>
        <ErrorList error={del.error} />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate(entry.id, { onSuccess: onClose })}>
            {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            מחק
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ACTION_LABEL: Record<string, string> = { create: 'נוצר', update: 'עודכן', delete: 'נמחק', seed: 'נזרע' }

function HistoryDialog({ entry, onClose }: { entry: BlocklistEntry; onClose: () => void }) {
  const q = useBlocklistDetail(entry.id)
  const log: BlocklistLogEntry[] = q.data?.log ?? []
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>היסטוריה — <span dir="ltr" className="font-mono">{entry.vin_prefix}</span></DialogTitle>
          <DialogDescription>{PROVIDER_LABEL[entry.provider]} — {entry.reason}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>}
        <ErrorList error={q.error} />
        {q.data && log.length === 0 && <div className="text-sm text-muted-foreground">אין רישומים.</div>}
        <ol className="space-y-2">
          {log.map((e, i) => (
            <li key={String(e.id ?? i)} className="rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 text-xs">
                <span className="font-semibold">{ACTION_LABEL[String(e.action)] ?? String(e.action ?? 'שינוי')}</span>
                <span className="text-muted-foreground">{shortUser(e.by)}</span>
                <span className="tabular-nums text-muted-foreground">{fmtDate(e.at)}</span>
              </div>
              {(e.after ?? e.before) != null && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">פרטים</summary>
                  <Json value={{ before: e.before, after: e.after }} />
                </details>
              )}
            </li>
          ))}
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
  | { kind: 'edit'; entry: BlocklistEntry | 'new' }
  | { kind: 'delete' | 'history'; entry: BlocklistEntry }
  | null

type ActiveFilter = 'yes' | 'no'

export default function VehicleBlocklistPage() {
  const list = useVehicleBlocklist()
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState<BlocklistProvider | ''>('')
  const [active, setActive] = useState<ActiveFilter | null>(null)
  const [modal, setModal] = useState<Modal>(null)

  const canEdit = !!list.data?.viewer?.canEdit
  const all = useMemo(() => list.data?.entries ?? [], [list.data])
  const rows = useMemo(
    () => filterEntries(all, { q, provider: provider || null, active: active == null ? null : active === 'yes' }),
    [all, q, provider, active],
  )
  const filtered = q || provider || active

  const iconBtn = 'h-8 w-8 text-muted-foreground hover:text-foreground'
  const actions = (e: BlocklistEntry) => (
    <div className="flex items-center justify-end gap-0.5">
      <Button variant="ghost" size="icon" className={iconBtn} title="היסטוריה" aria-label="היסטוריה" onClick={() => setModal({ kind: 'history', entry: e })}>
        <History />
      </Button>
      {canEdit && (
        <>
          <Button variant="ghost" size="icon" className={iconBtn} title="עריכה" aria-label="עריכה" onClick={() => setModal({ kind: 'edit', entry: e })}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="מחיקה" aria-label="מחיקה" onClick={() => setModal({ kind: 'delete', entry: e })}>
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  )

  const updated = (e: BlocklistEntry) => (
    <div className="text-xs leading-snug">
      <div dir="auto" className="max-w-[150px] truncate text-start" title={e.updated_by ?? e.created_by ?? undefined}>{shortUser(e.updated_by ?? e.created_by)}</div>
      <div dir="ltr" className="text-start tabular-nums text-muted-foreground" title={fmtDate(e.updated_at ?? e.created_at)}>
        {fmtDate(e.updated_at ?? e.created_at, false)}
      </div>
    </div>
  )

  const columns: DataTableColumn<BlocklistEntry>[] = [
    { key: 'vin_prefix', header: 'קידומת VIN', cell: e => <span dir="ltr" className="font-mono font-medium">{e.vin_prefix}</span>, sortable: true, exportValue: e => e.vin_prefix, cellClassName: 'w-px whitespace-nowrap' },
    { key: 'provider', header: 'ספק', cell: e => <ProviderBadge provider={e.provider} />, sortable: true, exportValue: e => e.provider, cellClassName: 'w-px whitespace-nowrap ps-6', headerClassName: 'ps-6' },
    { key: 'reason', header: 'סיבה', cell: e => <span dir="auto" className="block text-start">{e.reason}</span>, title: e => e.reason, sortable: true, exportValue: e => e.reason, cellClassName: 'min-w-[280px] ps-6', headerClassName: 'ps-6' },
    { key: 'active', header: 'פעיל', cell: e => <ActiveBadge active={e.active} />, sortable: true, sortValue: e => (e.active ? 0 : 1), exportValue: e => (e.active ? 'yes' : 'no'), cellClassName: 'w-px whitespace-nowrap ps-6', headerClassName: 'ps-6' },
    { key: 'updated_at', header: 'עודכן', cell: updated, sortable: true, sortValue: e => e.updated_at ?? e.created_at, exportValue: e => `${e.updated_by ?? ''} ${e.updated_at ?? ''}`.trim(), cellClassName: 'w-px whitespace-nowrap ps-6', headerClassName: 'ps-6' },
    { key: 'actions', header: '', cell: actions, exportHeader: 'מזהה', exportValue: e => e.id, cellClassName: 'w-px whitespace-nowrap' },
  ]

  const filterBar = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש קידומת, VIN, סיבה…" className="ps-8" aria-label="חיפוש" />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="נקה" className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <label className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">ספק</span>
        <select className={SELECT_CLS} value={provider} onChange={e => setProvider(e.target.value as BlocklistProvider | '')}>
          <option value="">הכל</option>
          {BLOCKLIST_PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
        </select>
      </label>
      <Segmented
        label="מצב"
        value={active}
        onChange={setActive}
        options={[{ value: null, label: 'הכל' }, { value: 'yes', label: 'פעיל' }, { value: 'no', label: 'מושבת' }]}
      />
      <span className="ms-auto text-xs tabular-nums text-muted-foreground">
        {filtered ? `${rows.length} מתוך ${all.length}` : `${all.length} רשומות`}
      </span>
    </div>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="רשימה שחורה"
        icon={Ban}
        description="רכבים ש־Partly לא סורק ולא מייבא, לפי קידומת VIN וספק"
        actions={canEdit ? (
          <Button size="sm" onClick={() => setModal({ kind: 'edit', entry: 'new' })}>
            <Plus /> חסימה חדשה
          </Button>
        ) : undefined}
      />

      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>שינויים כאן נאכפים ב־Partly תוך דקה (התחלת סריקה וייבוא), ובסריקת הלילה מהריצה הבאה</span>
      </div>

      {list.data && !canEdit && (
        <div className="text-xs text-muted-foreground">
          צפייה בלבד{list.data.viewer?.email ? ` (${list.data.viewer.email})` : ''} — עריכה מותרת למנהלים בלבד.
        </div>
      )}

      <VinCheck />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={e => e.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        defaultSort={{ field: 'vin_prefix', dir: 'asc' }}
        minWidth="min-w-[760px]"
        maxHeight="calc(100dvh - 12rem)"
        toolbar={filterBar}
        pageSize={50}
        exportFileName="vehicle-blocklist"
        mobileCard={{
          title: e => <span dir="ltr" className="font-mono">{e.vin_prefix}</span>,
          subtitle: e => <span>{e.reason}</span>,
          accent: e => <ProviderBadge provider={e.provider} />,
          fields: [
            { label: 'פעיל', value: e => <ActiveBadge active={e.active} /> },
            { label: 'עודכן', value: e => `${shortUser(e.updated_by ?? e.created_by)} ${fmtDate(e.updated_at ?? e.created_at)}` },
            { label: 'פעולות', value: actions },
          ],
        }}
        labels={{ empty: filtered ? 'אין חסימות שתואמות לסינון' : 'אין חסימות' }}
      />

      {modal?.kind === 'edit' && <EntryEditor key={modal.entry === 'new' ? 'new' : modal.entry.id} entry={modal.entry} onClose={() => setModal(null)} />}
      {modal?.kind === 'delete' && <DeleteConfirm entry={modal.entry} onClose={() => setModal(null)} />}
      {modal?.kind === 'history' && <HistoryDialog entry={modal.entry} onClose={() => setModal(null)} />}
    </div>
  )
}
