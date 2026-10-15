'use client'

import { use, useState } from 'react'
import { Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import {
  useBotSuppliers, useSaveBotSupplier, useSupplierParts, useUploadSupplier,
  type BotSupplier, type BotSupplierSettings,
} from '@/lib/bot-suppliers'

/**
 * /bots/<id>/suppliers - THE PART-NUMBER MAPPING (owner, 2026-10-15: "what about mapping part ids?").
 *
 * Another company's own number for an OEM part, with its price and stock, shown by the bot under the row as one
 * more option ("↳ קומט: ORG… · במלאי · ₪366.40 נטו"). Per supplier: connect / disconnect for THIS bot, which
 * price, stock on/off, the label, how many lines; the mapping itself, searchable; and a sheet upload that replaces
 * the supplier's data in one go. Bots re-read it every 5 minutes - no restart.
 */
export default function SuppliersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const he = locale === 'he'
  const tr = (h: string, e: string) => (he ? h : e)
  const list = useBotSuppliers(id)
  const [open, setOpen] = useState<string>('')

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {tr('מק"ט של ספק אחר לאותו חלק OEM, עם המחיר והמלאי שלו. הבוט מציג אותו מתחת לשורה כאפשרות נוספת, ומתעדכן תוך 5 דקות.',
            "Another supplier's own number for the same OEM part, with its price and stock. The bot shows it under the row; changes apply within 5 minutes.")}
      </p>
      {list.error && <p className="text-sm text-destructive">{(list.error as Error).message}</p>}
      {list.isLoading && <Skeleton className="h-40" />}
      {list.data?.map((s) => (
        <SupplierCard key={s.supplier_code} bot={id} s={s} he={he}
                      open={open === s.supplier_code} onToggle={() => setOpen(open === s.supplier_code ? '' : s.supplier_code)} />
      ))}
      {list.data && !list.data.length && <p className="text-sm text-muted-foreground">{tr('אין ספקים עדיין.', 'No suppliers yet.')}</p>}
      <UploadCard bot={id} he={he} suppliers={list.data ?? []} />
    </div>
  )
}

function SupplierCard({ bot, s, he, open, onToggle }: { bot: string; s: BotSupplier; he: boolean; open: boolean; onToggle: () => void }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const save = useSaveBotSupplier(bot)
  const cur: BotSupplierSettings = s.bot ?? { enabled: false, show_price: true, price_field: 'net', show_stock: true, label: null, max_alts: 2 }
  const [label, setLabel] = useState(cur.label ?? '')
  const put = (v: Partial<BotSupplierSettings>) => save.mutate({ supplier_code: s.supplier_code, ...cur, label: label || null, ...v })
  const shown = !!s.bot?.enabled
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{s.name_he || s.name} <span className="text-xs font-normal text-muted-foreground" dir="ltr">{s.supplier_code}</span></CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatNumber(s.parts)} {tr('פריטים', 'items')} · {formatNumber(s.oems)} {tr('מק"טי OEM', 'OEM numbers')} · {formatNumber(s.in_stock)} {tr('במלאי', 'in stock')}
            {s.source && <> · <span dir="ltr">{s.source}</span></>}
            {s.data_at && <> · {new Date(s.data_at).toLocaleDateString(he ? 'he-IL' : 'en-GB')}</>}
          </p>
        </div>
        <Badge className={shown ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}>
          {shown ? tr('מוצג בבוט', 'Shown') : tr('לא מחובר', 'Not connected')}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Button size="sm" variant={shown ? 'outline' : 'default'} disabled={save.isPending} onClick={() => put({ enabled: !shown })}>
            {shown ? tr('נתק מהבוט', 'Disconnect') : tr('חבר לבוט', 'Connect')}
          </Button>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={cur.show_price} onChange={(e) => put({ show_price: e.target.checked })} />
            {tr('הצג מחיר', 'Show price')}
          </label>
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={cur.price_field}
                  onChange={(e) => put({ price_field: e.target.value as 'net' | 'gross' })}>
            <option value="net">{tr('נטו (המחיר שלנו)', 'Net (our cost)')}</option>
            <option value="gross">{tr('ברוטו (מחירון)', 'Gross (list)')}</option>
          </select>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={cur.show_stock} onChange={(e) => put({ show_stock: e.target.checked })} />
            {tr('הצג מלאי', 'Show stock')}
          </label>
          <label className="inline-flex items-center gap-1.5">
            {tr('עד', 'Up to')}
            <select className="rounded-md border bg-background px-2 py-1 text-sm" value={cur.max_alts}
                    onChange={(e) => put({ max_alts: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {tr('שורות', 'lines')}
          </label>
          <span className="inline-flex items-center gap-1.5">
            {tr('שם בתשובה', 'Label')}
            <Input className="h-8 w-28" value={label} placeholder={s.name_he || s.name}
                   onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== (cur.label ?? '') && put({})} />
          </span>
        </div>
        {save.error && <p className="text-sm text-destructive">{(save.error as Error).message}</p>}
        <p className="text-xs text-muted-foreground">
          {tr('דוגמה בתשובה:', 'In an answer:')}{' '}
          <span className="font-mono">↳ {label || s.name_he || s.name}: ORG… · GENUINE PARTS{cur.show_stock ? ` · ${tr('במלאי', 'in stock')}` : ''}{cur.show_price ? ` · ₪… ${cur.price_field === 'net' ? 'נטו' : ''}` : ''}</span>
        </p>
        <Button size="sm" variant="ghost" onClick={onToggle}>{open ? tr('הסתר מיפוי', 'Hide mapping') : tr('הצג מיפוי מק"טים', 'Show part mapping')}</Button>
        {open && <PartsTable supplier={s.supplier_code} he={he} />}
      </CardContent>
    </Card>
  )
}

function PartsTable({ supplier, he }: { supplier: string; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [offset, setOffset] = useState(0)
  const parts = useSupplierParts(supplier, term, offset)
  const d = parts.data
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q.trim()) }}>
        <Input className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder={tr('חיפוש: מק"ט OEM, מק"ט ספק או תיאור', 'Search: OEM number, supplier number or description')} />
        <Button size="sm" type="submit">{tr('חפש', 'Search')}</Button>
      </form>
      {parts.isLoading && <Skeleton className="h-32" />}
      {parts.error && <p className="text-sm text-destructive">{(parts.error as Error).message}</p>}
      {d && (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-start">{tr('מק"ט OEM', 'OEM numbers')}</th>
                  <th className="px-2 py-1.5 text-start">{tr('מק"ט ספק', 'Supplier no.')}</th>
                  <th className="px-2 py-1.5 text-start">{tr('מותג', 'Brand')}</th>
                  <th className="px-2 py-1.5 text-start">{tr('תיאור', 'Description')}</th>
                  <th className="px-2 py-1.5 text-end">{tr('ברוטו', 'Gross')}</th>
                  <th className="px-2 py-1.5 text-end">{tr('נטו', 'Net')}</th>
                  <th className="px-2 py-1.5 text-start">{tr('מלאי', 'Stock')}</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((p) => (
                  <tr key={`${p.brand}|${p.part_no}`} className="border-t align-top">
                    <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">{p.oems.join(', ')}</td>
                    <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">{p.part_no}</td>
                    <td className="px-2 py-1.5 text-xs">{p.brand}</td>
                    <td className="px-2 py-1.5">{p.description}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">{p.price_gross != null ? `₪${p.price_gross.toLocaleString()}` : '—'}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">{p.price_net != null ? `₪${p.price_net.toLocaleString()}` : '—'}</td>
                    <td className="px-2 py-1.5">{p.in_stock === false ? <span className="text-destructive">{tr('חסר', 'Out')}</span> : tr('במלאי', 'In stock')}</td>
                  </tr>
                ))}
                {!d.items.length && <tr><td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">{tr('אין תוצאות', 'No results')}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatNumber(d.total)} {tr('פריטים', 'items')}</span>
            <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>{tr('הקודם', 'Prev')}</Button>
            <Button size="sm" variant="outline" disabled={offset + 50 >= d.total} onClick={() => setOffset(offset + 50)}>{tr('הבא', 'Next')}</Button>
          </div>
        </>
      )}
    </div>
  )
}

function UploadCard({ bot, he, suppliers }: { bot: string; he: boolean; suppliers: BotSupplier[] }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const up = useUploadSupplier(bot)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [nameHe, setNameHe] = useState('')
  const [sheet, setSheet] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const known = suppliers.find((s) => s.supplier_code === code)
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{tr('העלאת קובץ ספק', 'Upload a supplier sheet')}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {tr('קובץ Excel עם העמודות מק"ט, מק"ט OEM ואופציונלית שם פריט, ספק/יצרן, ברוטו, נטו, הנחה, מצב מלאי. ההעלאה מחליפה את כל הנתונים של הספק בבת אחת.',
              'An Excel sheet with מק"ט and מק"ט OEM, optionally שם פריט, ספק/יצרן, ברוטו, נטו, הנחה, מצב מלאי. An upload replaces all of that supplier\'s data at once.')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Input className="w-32" dir="ltr" placeholder="comet" value={code}
                 onChange={(e) => { const v = e.target.value.toLowerCase(); setCode(v); const k = suppliers.find((s) => s.supplier_code === v); if (k) { setName(k.name); setNameHe(k.name_he ?? '') } }} />
          <Input className="w-36" placeholder={tr('שם (אנגלית)', 'Name')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="w-36" placeholder={tr('שם בעברית', 'Hebrew name')} value={nameHe} onChange={(e) => setNameHe(e.target.value)} />
          <Input className="w-32" placeholder={tr('גיליון (לא חובה)', 'Sheet (optional)')} value={sheet} onChange={(e) => setSheet(e.target.value)} />
          <Input className="w-64" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {known && <p className="text-xs text-amber-700 dark:text-amber-400">{tr(`יחליף את ${formatNumber(known.parts)} הפריטים הקיימים של ${known.name_he || known.name}.`, `Replaces ${known.name}'s ${known.parts} existing items.`)}</p>}
        <Button size="sm" disabled={!file || !code || up.isPending} onClick={() => {
          if (known && !window.confirm(tr('להחליף את כל הנתונים של הספק?', "Replace all of this supplier's data?"))) return
          const f = new FormData()
          f.set('file', file as File); f.set('supplier_code', code); f.set('name', name || code); f.set('name_he', nameHe); f.set('sheet', sheet)
          up.mutate(f)
        }}>
          <Upload className="me-1 h-4 w-4" />{up.isPending ? tr('מעלה…', 'Uploading…') : tr('העלה', 'Upload')}
        </Button>
        {up.error && <p className="text-destructive">{(up.error as Error).message}</p>}
        {up.data && <p className="text-emerald-700 dark:text-emerald-400">
          {tr(`נטענו ${up.data.items} פריטים, ${up.data.oem_links} קישורי OEM (${up.data.in_stock} במלאי) מגיליון ${up.data.sheet}.`,
              `Loaded ${up.data.items} items, ${up.data.oem_links} OEM links (${up.data.in_stock} in stock) from ${up.data.sheet}.`)}
        </p>}
      </CardContent>
    </Card>
  )
}
