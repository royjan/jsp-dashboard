'use client'

import { useMemo, useState } from 'react'
import { Wrench, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  useServiceKits, useKitWrite, useErpItems, serviceKm, dueItems,
  type ServiceKit, type KitItem, type KitProduct,
} from '@/lib/service-kits'

/**
 * /service-kits - WHAT A PERIODIC SERVICE HOLDS (owner, 2026-10-16: "I want it in :3002").
 *
 * The Diego v5 "טיפול תקופתי" agent answers "טיפול 60 אלף ל-<plate>" from these rows: the kit for the car's fuel
 * type (a make-specific kit wins), every item whose interval divides the km, and the fluids as Jan codes by grade
 * and pack. One list for every bot - shop knowledge, not a bot setting. A save reaches the bot within seconds
 * (NOTIFY kits_changed). The old keyword kits of jsp-chat-js /admin/kits are not shown here.
 */

const FUELS = ['בנזין', 'דיזל', 'חשמל', 'חשמל/בנזין', 'חשמל/דיזל', 'גפמ"']
const FLUID_HE: Record<string, string> = { engine_oil: 'שמן מנוע', brake_fluid: 'נוזל בלמים', coolant: 'נוזל קירור' }
const QTY_FROM_HE: Record<string, string> = {
  cylinders: 'לפי מספר הצילינדרים', oil_litres: 'לפי ליטרי השמן של המנוע', coolant_litres: 'לפי ליטרי נוזל הקירור',
}
const NEEDS_HE: Record<string, string> = {
  timing_belt: 'רק במנוע עם רצועת טיימינג', spark_plugs: 'רק במנוע עם מצתים', fuel_filter: 'רק עם מסנן דלק',
}
const km = (n: number) => `${formatNumber(n)} ק"מ`
const sel = 'h-8 rounded-md border bg-background px-2 text-sm'
const csv = (a: string[] | null | undefined) => (a ?? []).join(', ')

export default function ServiceKitsPage() {
  const { dir } = useLocale()
  const q = useServiceKits()
  const [picked, setPicked] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const kits = q.data?.kits ?? []
  const kit = kits.find((k) => k.id === picked) ?? kits[0]

  return (
    <div dir={dir} className="space-y-6">
      <PageHeader icon={Wrench} title="טיפולים תקופתיים"
        description='מה כולל כל טיפול, לפי סוג דלק וק"מ, ואילו מק"טים של שמנים ונוזלים הבוט מציע. רשימה אחת לכל הבוטים; שינוי מגיע לבוט תוך שניות.' />
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.isLoading && <Skeleton className="h-48" />}
      {q.data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {kits.map((k) => (
              <button key={k.id} onClick={() => { setPicked(k.id); setAdding(false) }}
                      className={cn('rounded-lg border px-3 py-2 text-start text-sm transition-colors',
                        k.id === kit?.id && !adding ? 'border-primary bg-primary/5' : 'hover:bg-muted', !k.is_active && 'opacity-60')}>
                <div className="font-medium">{k.name}{!k.is_active && <span className="ms-1 text-xs text-muted-foreground">(כבוי)</span>}</div>
                <div className="text-xs text-muted-foreground">
                  {csv(k.fuel_types) || 'כל סוגי הדלק'}{k.makes?.length ? ` · ${csv(k.makes)}` : ''} · {k.items.length} פריטים
                </div>
              </button>
            ))}
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus className="me-1 h-4 w-4" />ערכה חדשה</Button>
          </div>
          {adding && <NewKit kits={kits} onDone={(id) => { setAdding(false); if (id) setPicked(id) }} />}
          {kit && !adding && <KitCard key={kit.id} kit={kit} />}
          <ProductsCard products={q.data.products} />
        </>
      )}
    </div>
  )
}

// ── a kit ─────────────────────────────────────────────────────────────────────────────

function FuelPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {FUELS.map((f) => (
        <label key={f} className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={value.includes(f)}
                 onChange={(e) => onChange(e.target.checked ? [...value, f] : value.filter((x) => x !== f))} />{f}
        </label>
      ))}
    </div>
  )
}

function NewKit({ kits, onDone }: { kits: ServiceKit[]; onDone: (id?: string) => void }) {
  const w = useKitWrite()
  const [name, setName] = useState('')
  const [fuels, setFuels] = useState<string[]>([])
  const [makes, setMakes] = useState('')
  const [from, setFrom] = useState('')
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">ערכת טיפול חדשה</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          ערכה ליצרן מסוים (למשל פיג&apos;ו בנזין) גוברת על הכללית של אותו סוג דלק. הכי קל: להעתיק ערכה קיימת ולשנות.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">שם</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="service petrol PSA" /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">יצרנים (ריק = כללי), מופרד בפסיקים</span>
            <Input value={makes} onChange={(e) => setMakes(e.target.value)} placeholder="פיג'ו, סיטרואן" /></label>
        </div>
        <div className="space-y-1"><span className="text-xs text-muted-foreground">סוג דלק (כמו ברישוי)</span>
          <FuelPicker value={fuels} onChange={setFuels} /></div>
        <label className="flex items-center gap-2"><span className="text-xs text-muted-foreground">להעתיק פריטים מ:</span>
          <select className={sel} value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">— ריקה —</option>
            {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select></label>
        {w.error && <p className="text-destructive">{(w.error as Error).message}</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={!name.trim() || w.isPending}
                  onClick={() => w.mutate({ method: 'POST', entity: 'kit', data: { name, fuel_types: fuels, makes, copy_from: from || undefined } },
                                          { onSuccess: (r) => onDone(String(r.id)) })}>צור</Button>
          <Button size="sm" variant="ghost" onClick={() => onDone()}>ביטול</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function KitCard({ kit }: { kit: ServiceKit }) {
  const w = useKitWrite()
  const [name, setName] = useState(kit.name)
  const [fuels, setFuels] = useState<string[]>(kit.fuel_types ?? [])
  const [makes, setMakes] = useState(csv(kit.makes))
  const [priority, setPriority] = useState(String(kit.priority))
  const dirty = name !== kit.name || csv(fuels) !== csv(kit.fuel_types) || makes !== csv(kit.makes) || priority !== String(kit.priority)
  const save = (extra: Record<string, unknown> = {}) =>
    w.mutate({ method: 'PUT', entity: 'kit', id: kit.id, data: { name, fuel_types: fuels, makes, priority, is_active: kit.is_active, ...extra } })
  const sorted = useMemo(() => [...kit.items].sort((a, b) => a.sort - b.sort || a.id - b.id), [kit.items])

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">{kit.name}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            עודכן {new Date(kit.updated_at).toLocaleString('he-IL')}{kit.created_by ? ` · נוצר ע"י ${kit.created_by}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className={kit.is_active ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}>
            {kit.is_active ? 'פעילה' : 'כבויה'}
          </Badge>
          <Button size="sm" variant="outline" disabled={w.isPending} onClick={() => save({ is_active: !kit.is_active })}>
            {kit.is_active ? 'כבה' : 'הפעל'}
          </Button>
          <Button size="sm" variant="outline" disabled={w.isPending}
                  onClick={() => window.confirm(`למחוק את "${kit.name}" ואת כל ${kit.items.length} הפריטים שלה?`)
                    && w.mutate({ method: 'DELETE', entity: 'kit', id: kit.id })}>
            <Trash2 className="me-1 h-4 w-4" />מחק
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-[2fr_2fr_1fr]">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">שם</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">יצרנים (ריק = כללי)</span>
            <Input value={makes} onChange={(e) => setMakes(e.target.value)} placeholder="כל היצרנים" /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">עדיפות (נמוך קודם)</span>
            <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} /></label>
        </div>
        <div className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">סוג דלק</span>
          <FuelPicker value={fuels} onChange={setFuels} /></div>
        {dirty && <Button size="sm" disabled={w.isPending} onClick={() => save()}>שמור פרטי ערכה</Button>}
        {w.error && <p className="text-sm text-destructive">{(w.error as Error).message}</p>}

        <KmPreview items={sorted} />
        <ItemsTable kitId={kit.id} items={sorted} />
      </CardContent>
    </Card>
  )
}

function KmPreview({ items }: { items: KitItem[] }) {
  const [raw, setRaw] = useState('60000')
  const asked = raw.trim() === '' ? null : Math.round(Number(raw.replace(/[,\s]/g, '')) * (Number(raw) < 1000 ? 1000 : 1))
  const n = asked !== null && Number.isFinite(asked) ? serviceKm(asked, items) : null
  const due = dueItems(items, n)
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">תצוגה מקדימה:</span> טיפול
        <Input className="h-8 w-28" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder='ק"מ (ריק = בסיסי)' dir="ltr" />
        <span className="text-muted-foreground">
          {n === null ? '→ טיפול בסיסי (בלי ק"מ)' : `→ ${km(n)}${asked !== n ? ` (עוגל מ-${formatNumber(asked!)})` : ''}`} · {due.length} פריטים
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {due.map((i) => (
          <span key={i.id} className={cn('rounded-md border bg-background px-2 py-0.5 text-xs', i.optional && 'border-dashed text-muted-foreground')}
                title={i.needs ? NEEDS_HE[i.needs] : undefined}>
            {i.part_he}{i.needs ? ' *' : ''}{i.optional ? ' (רשות)' : ''}
          </span>
        ))}
        {!due.length && <span className="text-xs text-muted-foreground">אין פריטים בטיפול הזה</span>}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        * תלוי במנוע: הבוט בודק (Gemini) אם יש רצועת טיימינג / מצתים / מסנן דלק ומוריד את הפריט אם אין. כמויות לפי המנוע נקבעות שם.
      </p>
    </div>
  )
}

// ── items ─────────────────────────────────────────────────────────────────────────────

type ItemDraft = Omit<KitItem, 'id' | 'kit_id' | 'created_by' | 'updated_at' | 'updated_by' | 'match_he'> & { match_he: string }
const blankItem = (sort: number): ItemDraft => ({
  sort, part_en: '', part_he: '', match_he: '', source: 'catalog', fluid: null, qty: 1, unit: 'pcs', qty_from: null,
  every_km: 30000, every_months: null, needs: null, basic: false, optional: false, note_he: null,
})
const toDraft = (i: KitItem): ItemDraft => ({ ...i, match_he: csv(i.match_he) })

function ItemsTable({ kitId, items }: { kitId: string; items: KitItem[] }) {
  const w = useKitWrite()
  const [edit, setEdit] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<ItemDraft>(blankItem(100))
  const start = (i: KitItem | null) => {
    setDraft(i ? toDraft(i) : blankItem((items.at(-1)?.sort ?? 0) + 10))
    setEdit(i ? i.id : 'new')
  }
  const save = () => w.mutate(
    edit === 'new' ? { method: 'POST', entity: 'item', data: { ...draft, kit_id: kitId } }
                   : { method: 'PUT', entity: 'item', id: edit!, data: { ...draft } },
    { onSuccess: () => setEdit(null) })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">פריטים בטיפול</h3>
        <Button size="sm" variant="outline" onClick={() => start(null)} disabled={edit !== null}><Plus className="me-1 h-4 w-4" />פריט</Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-start">#</th>
              <th className="px-2 py-1.5 text-start">חלק</th>
              <th className="px-2 py-1.5 text-start" title="מה הבוט מחפש בקטלוג, באנגלית">חיפוש</th>
              <th className="px-2 py-1.5 text-start" title="שורה בקטלוג נחשבת לפריט רק אם השם שלה מתחיל באחד מאלה">מתחיל ב</th>
              <th className="px-2 py-1.5 text-start">מקור</th>
              <th className="px-2 py-1.5 text-start">כמות</th>
              <th className="px-2 py-1.5 text-start">כל</th>
              <th className="px-2 py-1.5 text-start">תלוי ב</th>
              <th className="px-2 py-1.5 text-center" title="נכלל בטיפול כשלא נמסר ק&quot;מ">בסיסי</th>
              <th className="px-2 py-1.5 text-center" title="מוצג אם נמצא; אם לא - לא מדווח כחסר">רשות</th>
              <th className="px-2 py-1.5 text-start">הערה</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => edit === i.id
              ? <ItemEditRow key={i.id} d={draft} set={setDraft} onSave={save} onCancel={() => setEdit(null)} busy={w.isPending} />
              : (
                <tr key={i.id} className="border-t align-top">
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{i.sort}</td>
                  <td className="px-2 py-1.5 font-medium">{i.part_he}</td>
                  <td className="px-2 py-1.5 text-xs" dir="ltr">{i.part_en}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{csv(i.match_he) || '—'}</td>
                  <td className="px-2 py-1.5 text-xs">{i.source === 'fluid' ? FLUID_HE[i.fluid ?? ''] ?? i.fluid : 'קטלוג'}</td>
                  <td className="px-2 py-1.5 text-xs">{i.qty_from ? QTY_FROM_HE[i.qty_from] : `${i.qty} ${i.unit === 'L' ? 'ל\'' : 'יח\''}`}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-xs tabular-nums">
                    {km(i.every_km)}{i.every_months ? ` / ${i.every_months} ח'` : ''}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{i.needs ? NEEDS_HE[i.needs] : '—'}</td>
                  <td className="px-2 py-1.5 text-center">{i.basic ? '✓' : ''}</td>
                  <td className="px-2 py-1.5 text-center">{i.optional ? '✓' : ''}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{i.note_he}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={edit !== null} onClick={() => start(i)} title="ערוך"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={edit !== null || w.isPending} title="מחק"
                            onClick={() => window.confirm(`למחוק את "${i.part_he}"?`) && w.mutate({ method: 'DELETE', entity: 'item', id: i.id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            {edit === 'new' && <ItemEditRow d={draft} set={setDraft} onSave={save} onCancel={() => setEdit(null)} busy={w.isPending} />}
          </tbody>
        </table>
      </div>
      {w.error && <p className="text-sm text-destructive">{(w.error as Error).message}</p>}
    </div>
  )
}

function ItemEditRow({ d, set, onSave, onCancel, busy }: {
  d: ItemDraft; set: (d: ItemDraft) => void; onSave: () => void; onCancel: () => void; busy: boolean
}) {
  const up = (v: Partial<ItemDraft>) => set({ ...d, ...v })
  const cell = 'px-1 py-1'
  return (
    <tr className="border-t bg-primary/5 align-top">
      <td className={cell}><Input className="h-8 w-14" type="number" value={d.sort} onChange={(e) => up({ sort: Number(e.target.value) })} /></td>
      <td className={cell}><Input className="h-8 w-32" value={d.part_he} onChange={(e) => up({ part_he: e.target.value })} placeholder="מסנן שמן" /></td>
      <td className={cell}><Input className="h-8 w-32" dir="ltr" value={d.part_en} onChange={(e) => up({ part_en: e.target.value })} placeholder="oil filter" /></td>
      <td className={cell}><Input className="h-8 w-36" value={d.match_he} onChange={(e) => up({ match_he: e.target.value })} placeholder="מסנן שמן, פילטר שמן" /></td>
      <td className={cell}>
        <select className={sel} value={d.source === 'fluid' ? d.fluid ?? '' : 'catalog'}
                onChange={(e) => up(e.target.value === 'catalog' ? { source: 'catalog', fluid: null } : { source: 'fluid', fluid: e.target.value, unit: 'L' })}>
          <option value="catalog">קטלוג</option>
          {Object.entries(FLUID_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td className={cell}>
        <div className="flex flex-col gap-1">
          <select className={sel} value={d.qty_from ?? ''} onChange={(e) => up({ qty_from: e.target.value || null })}>
            <option value="">כמות קבועה</option>
            {Object.entries(QTY_FROM_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {!d.qty_from && (
            <div className="flex gap-1">
              <Input className="h-8 w-16" type="number" step="0.5" value={d.qty} onChange={(e) => up({ qty: Number(e.target.value) })} />
              <select className={sel} value={d.unit} onChange={(e) => up({ unit: e.target.value as 'pcs' | 'L' })}>
                <option value="pcs">יח&apos;</option><option value="L">ליטר</option>
              </select>
            </div>
          )}
        </div>
      </td>
      <td className={cell}>
        <div className="flex flex-col gap-1">
          <Input className="h-8 w-24" type="number" step="5000" value={d.every_km} onChange={(e) => up({ every_km: Number(e.target.value) })} title='כל כמה ק"מ' />
          <Input className="h-8 w-24" type="number" value={d.every_months ?? ''} placeholder="חודשים"
                 onChange={(e) => up({ every_months: e.target.value ? Number(e.target.value) : null })} />
        </div>
      </td>
      <td className={cell}>
        <select className={sel} value={d.needs ?? ''} onChange={(e) => up({ needs: e.target.value || null })}>
          <option value="">—</option>
          {Object.entries(NEEDS_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td className={cn(cell, 'text-center')}><input type="checkbox" checked={d.basic} onChange={(e) => up({ basic: e.target.checked })} /></td>
      <td className={cn(cell, 'text-center')}><input type="checkbox" checked={d.optional} onChange={(e) => up({ optional: e.target.checked })} /></td>
      <td className={cell}><Input className="h-8 w-32" value={d.note_he ?? ''} onChange={(e) => up({ note_he: e.target.value || null })} /></td>
      <td className={cn(cell, 'whitespace-nowrap')}>
        <Button size="icon" className="h-7 w-7" disabled={busy || !d.part_he.trim() || !d.part_en.trim()} onClick={onSave} title="שמור"><Check className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCancel} title="ביטול"><X className="h-3.5 w-3.5" /></Button>
      </td>
    </tr>
  )
}

// ── fluids ────────────────────────────────────────────────────────────────────────────

type ProductDraft = Omit<KitProduct, 'id' | 'updated_at' | 'updated_by' | 'makes'> & { makes: string }
const blankProduct = (): ProductDraft => ({ fluid: 'engine_oil', grade: '5W-30', pack_l: 5, item_code: '', makes: '', sort: 100, note: null })

function ProductsCard({ products }: { products: KitProduct[] }) {
  const w = useKitWrite()
  const [edit, setEdit] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<ProductDraft>(blankProduct())
  const erp = useErpItems([...products.map((p) => p.item_code), ...(draft.item_code.trim().length >= 3 && edit !== null ? [draft.item_code.trim()] : [])])
  const start = (p: KitProduct | null) => {
    setDraft(p ? { ...p, makes: csv(p.makes) } : blankProduct())
    setEdit(p ? p.id : 'new')
  }
  const save = () => w.mutate(
    edit === 'new' ? { method: 'POST', entity: 'product', data: { ...draft } }
                   : { method: 'PUT', entity: 'product', id: edit!, data: { ...draft } },
    { onSuccess: () => setEdit(null) })
  const info = (code: string) => {
    const c = code.trim().toUpperCase()
    if (!c) return null
    if (erp.isLoading) return <span className="text-muted-foreground">…</span>
    const it = erp.data?.[c]
    if (it === undefined) return null
    if (it === null) return <span className="text-destructive">לא נמצא ב-ERP</span>
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <bdi>{it.name}</bdi>
        <span className={it.stock_qty > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>
          {it.stock_qty > 0 ? <>במלאי <bdi>{formatNumber(it.stock_qty)}</bdi></> : 'אין במלאי'}
        </span>
        {it.incoming_qty > 0 && <span className="text-muted-foreground">(+<bdi>{formatNumber(it.incoming_qty)}</bdi> בדרך)</span>}
        {it.price != null && <bdi className="tabular-nums">₪{it.price.toLocaleString('he-IL', { maximumFractionDigits: 2 })}</bdi>}
      </span>
    )
  }
  const cell = 'px-1 py-1'
  const up = (v: Partial<ProductDraft>) => setDraft({ ...draft, ...v })
  const editRow = (key: string) => (
    <tr key={key} className="border-t bg-primary/5 align-top">
      <td className={cell}>
        <select className={sel} value={draft.fluid} onChange={(e) => up({ fluid: e.target.value })}>
          {Object.entries(FLUID_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </td>
      <td className={cell}><Input className="h-8 w-24" dir="ltr" value={draft.grade} onChange={(e) => up({ grade: e.target.value })} placeholder="5W-30" /></td>
      <td className={cell}><Input className="h-8 w-16" type="number" step="0.5" value={draft.pack_l} onChange={(e) => up({ pack_l: Number(e.target.value) })} /></td>
      <td className={cell}><Input className="h-8 w-32 font-mono" dir="ltr" value={draft.item_code} onChange={(e) => up({ item_code: e.target.value.toUpperCase() })} /></td>
      <td className="px-2 py-1.5 text-xs">{info(draft.item_code)}</td>
      <td className={cell}><Input className="h-8 w-28" value={draft.makes} onChange={(e) => up({ makes: e.target.value })} placeholder="כל היצרנים" /></td>
      <td className={cell}><Input className="h-8 w-16" type="number" value={draft.sort} onChange={(e) => up({ sort: Number(e.target.value) })} /></td>
      <td className={cell}><Input className="h-8 w-28" value={draft.note ?? ''} onChange={(e) => up({ note: e.target.value || null })} /></td>
      <td className={cn(cell, 'whitespace-nowrap')}>
        <Button size="icon" className="h-7 w-7" disabled={w.isPending || !draft.item_code.trim() || !draft.grade.trim()} onClick={save} title="שמור"><Check className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEdit(null)} title="ביטול"><X className="h-3.5 w-3.5" /></Button>
      </td>
    </tr>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">שמנים ונוזלים</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            שמנים לא מופיעים בשרטוטים, לכן הבוט בוחר מכאן: לפי הדרגה שהמנוע צריך, מהאריזות שבמלאי, בצירוף הזול ביותר לכמות הליטרים. &quot;סדר&quot; נמוך = מועדף.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => start(null)} disabled={edit !== null}><Plus className="me-1 h-4 w-4" />מק&quot;ט</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-start">נוזל</th>
                <th className="px-2 py-1.5 text-start">דרגה</th>
                <th className="px-2 py-1.5 text-start">אריזה (ל&apos;)</th>
                <th className="px-2 py-1.5 text-start">מק&quot;ט</th>
                <th className="px-2 py-1.5 text-start">ב-ERP עכשיו</th>
                <th className="px-2 py-1.5 text-start">יצרנים</th>
                <th className="px-2 py-1.5 text-start">סדר</th>
                <th className="px-2 py-1.5 text-start">הערה</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => edit === p.id ? editRow(String(p.id)) : (
                <tr key={p.id} className="border-t align-top">
                  <td className="px-2 py-1.5 text-xs">{FLUID_HE[p.fluid] ?? p.fluid}</td>
                  <td className="px-2 py-1.5 font-medium" dir="ltr">{p.grade}</td>
                  <td className="px-2 py-1.5 tabular-nums">{p.pack_l}</td>
                  <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">{p.item_code}</td>
                  <td className="px-2 py-1.5 text-xs">{info(p.item_code)}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{csv(p.makes) || 'כולם'}</td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{p.sort}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{p.note}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={edit !== null} onClick={() => start(p)} title="ערוך"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={edit !== null || w.isPending} title="מחק"
                            onClick={() => window.confirm(`להסיר את ${p.item_code} (${p.grade} ${p.pack_l} ל')?`) && w.mutate({ method: 'DELETE', entity: 'product', id: p.id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {edit === 'new' && editRow('new')}
            </tbody>
          </table>
        </div>
        {erp.error && <p className="mt-2 text-xs text-muted-foreground">מלאי ומחיר לא זמינים כרגע ({(erp.error as Error).message})</p>}
        {w.error && <p className="mt-2 text-sm text-destructive">{(w.error as Error).message}</p>}
      </CardContent>
    </Card>
  )
}
