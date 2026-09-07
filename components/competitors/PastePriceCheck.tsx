'use client'

/**
 * Paste a price list, get our side of it.
 *
 * The competitor uploader takes a versioned `.xlsx` with a sheet per
 * competitor. Most price lists are not that — they are twenty lines in a
 * WhatsApp message or an email, and until now there was no way to get them in
 * front of our own numbers short of typing them into a spreadsheet.
 *
 * Nothing here is stored. It is a lookup, so a list you were sent can be
 * answered while the person who sent it is still on the phone.
 */

import { useMemo, useState } from 'react'
import { ClipboardPaste, Loader2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { usePriceCheck } from '@/hooks/use-fakes'
import { formatCurrency, formatNumber } from '@/lib/format'
import { costAgeDays, overCostPct as overCost, STALE_COST_DAYS } from '@/lib/fake-scan'
import { parsePastedPrices, type SkippedPriceRow } from '@/lib/paste-prices'
import type { PriceCheckHit } from '@/app/api/competitors/price-check/route'

const PLACEHOLDER = `1109AY\t17
0249E6  52.60  מקורי
9833351080, 38`

interface CheckedRow extends Partial<PriceCheckHit> {
  code: string
  rawCode: string
  theirPrice: number
  note?: string
  /** Their price over our cost, as a percent. Negative = under our cost. */
  overCostPct: number | null
  costAge: number | null
  known: boolean
}

/** Under cost is red, thin margin amber, healthy gap plain. */
function priceTone(overCostPct: number | null): string {
  if (overCostPct === null) return ''
  if (overCostPct < 0) return 'text-destructive font-medium'
  if (overCostPct < 15) return 'text-amber-600 dark:text-amber-400'
  return ''
}

const COLUMNS: DataTableColumn<CheckedRow>[] = [
  {
    key: 'code',
    header: 'מק"ט',
    sortable: true,
    cell: r => (r.known ? <ItemLink code={r.itemCode ?? r.code} showCode /> : <span>{r.rawCode}</span>),
    exportValue: r => r.itemCode ?? r.rawCode,
    cellClassName: 'font-mono text-xs',
  },
  {
    key: 'erpName',
    header: 'שם',
    sortable: true,
    truncate: 'max-w-[220px]',
    title: r => r.erpName ?? '',
    cell: r => <span dir="rtl">{r.erpName ?? (r.known ? '—' : 'לא מוכר')}</span>,
    exportValue: r => r.erpName ?? '',
  },
  {
    key: 'theirPrice',
    header: 'מחיר ברשימה',
    align: 'end',
    sortable: true,
    cell: r => formatCurrency(r.theirPrice, 2),
    exportValue: r => r.theirPrice,
  },
  {
    key: 'cost',
    header: 'עלות שלנו',
    align: 'end',
    sortable: true,
    cell: r =>
      r.cost ? (
        <span className="inline-flex items-center gap-1.5">
          {formatCurrency(r.cost, 2)}
          {r.costAge !== null && r.costAge > STALE_COST_DAYS && (
            <Badge variant="warning" className="text-[10px]">ישנה</Badge>
          )}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    exportValue: r => r.cost ?? null,
  },
  {
    key: 'overCostPct',
    header: 'מול העלות',
    align: 'end',
    sortable: true,
    cell: r =>
      r.overCostPct === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className={priceTone(r.overCostPct)}>
          {r.overCostPct > 0 ? '+' : ''}
          {r.overCostPct.toFixed(0)}%
        </span>
      ),
    exportValue: r => r.overCostPct,
  },
  {
    key: 'listPrice',
    header: 'מחירון שלנו',
    align: 'end',
    sortable: true,
    cell: r => (r.listPrice ? formatCurrency(r.listPrice, 2) : <span className="text-muted-foreground">—</span>),
    exportValue: r => r.listPrice ?? null,
  },
  {
    key: 'inStock',
    header: 'מלאי',
    align: 'end',
    sortable: true,
    cell: r =>
      r.inStock === null || r.inStock === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        formatNumber(r.inStock)
      ),
    // "unknown" must not sort as "none".
    exportValue: r => r.inStock ?? null,
  },
  {
    key: 'bestCompetitorPrice',
    header: 'מתחרה זול ביותר',
    align: 'end',
    sortable: true,
    cell: r =>
      r.bestCompetitorPrice ? (
        <span className="whitespace-nowrap">
          {formatCurrency(r.bestCompetitorPrice, 2)}
          <span className="text-muted-foreground text-xs"> · {r.bestCompetitor}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    exportValue: r => r.bestCompetitorPrice ?? null,
  },
]

export function PastePriceCheck() {
  const [text, setText] = useState('')
  const check = usePriceCheck()

  const parsed = useMemo(() => parsePastedPrices(text), [text])

  const rows: CheckedRow[] = useMemo(() => {
    const hits = new Map((check.data?.hits ?? []).map(h => [h.code, h]))
    if (!check.data) return []
    return parsed.rows.map(p => {
      const hit = hits.get(p.code)
      const overCostPct = overCost(p.price, hit?.cost ?? null)
      return {
        ...hit,
        code: p.code,
        rawCode: p.rawCode,
        theirPrice: p.price,
        note: p.note,
        overCostPct,
        costAge: costAgeDays(hit?.costDate ?? null),
        known: Boolean(hit),
      }
    })
  }, [parsed.rows, check.data])

  const run = () => {
    if (!parsed.rows.length) return
    check.mutate(parsed.rows.map(r => r.code))
  }

  const underCost = rows.filter(r => r.overCostPct !== null && r.overCostPct < 0).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardPaste className="h-4 w-4" />
          בדיקת רשימת מחירים מודבקת
        </CardTitle>
        <CardDescription>
          הדביקו שורות של &quot;מק&quot;ט מחיר&quot; — מאקסל, מוואטסאפ או ממייל. מוצג מולן מה שיש לנו:
          עלות, מחירון, מלאי, והמחיר הזול ביותר של מתחרה שכבר נמצא במערכת. שום דבר לא נשמר.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          dir="ltr"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={6}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed
                     focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={!parsed.rows.length || check.isPending} className="gap-2">
            {check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            בדוק {parsed.rows.length ? `(${parsed.rows.length})` : ''}
          </Button>

          {parsed.skipped.length > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {parsed.skipped.length} שורות דולגו
            </span>
          )}
          {check.data && (
            <span className="text-xs text-muted-foreground">
              {rows.length - check.data.unknown.length} מוכרים · {check.data.unknown.length} לא מוכרים
              {underCost > 0 && <> · <span className="text-destructive">{underCost} מתחת לעלות שלנו</span></>}
            </span>
          )}
          {check.error && <span className="text-xs text-destructive">{check.error.message}</span>}
        </div>

        {parsed.skipped.length > 0 && <SkippedList skipped={parsed.skipped} />}

        {check.data && (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            getRowKey={r => r.code}
            defaultSort={{ field: 'overCostPct', dir: 'asc' }}
            minWidth="min-w-[860px]"
            exportFileName="price-check"
            pageSize={25}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** What was dropped and why — a paste that quietly lost three lines is worse
 *  than one that says so. */
function SkippedList({ skipped }: { skipped: SkippedPriceRow[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      <button onClick={() => setOpen(o => !o)} className="font-medium text-amber-700 dark:text-amber-400">
        {skipped.length} שורות לא נקראו {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {skipped.slice(0, 20).map(s => (
            <li key={s.line} className="flex gap-2 text-muted-foreground">
              <span className="shrink-0 font-mono">#{s.line}</span>
              <span className="truncate font-mono" dir="ltr">{s.text}</span>
              <span className="shrink-0">— {s.reason}</span>
            </li>
          ))}
          {skipped.length > 20 && <li className="text-muted-foreground">…ועוד {skipped.length - 20}</li>}
        </ul>
      )}
    </div>
  )
}
