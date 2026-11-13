'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link2Off, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemLink } from '@/components/shared/ItemLink'
import { useLocale } from '@/lib/locale-context'
import { cn } from '@/lib/utils'

type Kind = 'missing' | 'name_only' | 'fork'
type Row = { kind: Kind; code: string; name: string | null; link: string; sold: number; stock: number }
type Payload = { at: string; counts: Record<Kind, number>; rows: Row[] }

/*
 * Broken supersession links in the ERP (owner, 2026-11-13). Every system follows the ERP's
 * "replaced by" / "previous" fields, so one fix in Finansit fixes Diego web, the WhatsApp bot,
 * this dashboard and FINAPI at once. Read-only: nothing here writes to the ERP.
 */
const KIND = {
  missing: {
    he: 'מצביע על משהו שאינו פריט', en: 'Points at a non-item',
    doHe: 'לנקות את השדה "הוחלף ב", או לכתוב בו את הקוד המחליף', doEn: 'Clear "replaced by", or write the real successor',
    cls: 'bg-destructive/10 text-destructive',
  },
  name_only: {
    he: 'קישור רק לפי שם', en: 'Linked by name only',
    doHe: 'להעתיק את הקוד מהשם לשדה "הוחלף ב"', doEn: 'Copy the code from the name into "replaced by"',
    cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  fork: {
    he: 'הוחלף ביותר מפריט אחד', en: 'Replaced by two items',
    doHe: 'לבדוק אם זה באמת שני חלקים (מנורה + נורה) או טעות באחד', doEn: 'Check whether these are two real parts or one is a mistake',
    cls: 'bg-info-subtle text-info-subtle-foreground',
  },
} as const

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmtAt = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
const isShelf = (s: string) => /^\d+[A-Z]?-\d+$/i.test(s.trim()) || /^0+$/.test(s.trim())

export default function ChainHealthPage() {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [q, setQ] = useState('')
  const [fresh, setFresh] = useState(0)
  const { data, isLoading, isFetching, error } = useQuery<Payload>({
    queryKey: ['chain-health', fresh],
    queryFn: async () => {
      const r = await fetch(`/api/chain-health${fresh ? '?fresh=1' : ''}`)
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    },
    staleTime: 10 * 60 * 1000,
  })
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data?.rows ?? []).filter((r) => (kind === 'all' || r.kind === kind)
      && (!t || r.code.toLowerCase().includes(t) || (r.name ?? '').toLowerCase().includes(t) || r.link.toLowerCase().includes(t)))
  }, [data, kind, q])

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title={isHe ? 'קישורים שבורים בשרשראות קודים' : 'Broken code-chain links'}
        description={isHe
          ? 'פריטים שהקישור "הוחלף ב" / "קודם" שלהם בפיננסית שבור או חלקי. תיקון אחד בפיננסית מתקן את האתר, הבוט והדשבורד. הנמכרים ביותר ראשונים. קריאה בלבד, מהעתק ה-Postgres.'
          : 'Items whose ERP "replaced by" / "previous" link is broken or half there. One fix in the ERP fixes every system. Best sellers first. Read-only.'}
        icon={Link2Off}
        actions={
          <Button variant="outline" size="sm" onClick={() => setFresh((n) => n + 1)} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            {isHe ? 'רענן' : 'Refresh'}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'missing', 'name_only', 'fork'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={cn('rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              kind === k ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted')}
          >
            {k === 'all' ? (isHe ? 'הכול' : 'All') : (isHe ? KIND[k].he : KIND[k].en)}
            {data && <span className="ms-1.5 tabular-nums opacity-70">{k === 'all' ? data.rows.length : data.counts[k]}</span>}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isHe ? 'חיפוש קוד או שם' : 'Search code or name'} className="ms-auto h-9 w-56" />
        {data && <span className="text-xs text-muted-foreground">{isHe ? 'עודכן' : 'Updated'} {fmtAt(data.at)}</span>}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{isHe ? 'הטעינה נכשלה' : 'Failed to load'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{isHe ? 'קוד' : 'Code'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isHe ? 'שם בפיננסית' : 'ERP name'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isHe ? 'הבעיה' : 'Problem'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isHe ? 'מצביע על' : 'Points at'}</th>
                    <th className="px-3 py-2 text-end font-medium">{isHe ? 'נמכר השנה' : 'Sold YTD'}</th>
                    <th className="px-3 py-2 text-end font-medium">{isHe ? 'מלאי' : 'Stock'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isHe ? 'מה לעשות' : 'What to do'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 600).map((r) => (
                    <tr key={`${r.kind}-${r.code}`} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2 font-mono" dir="ltr"><ItemLink code={r.code} showCode copyable /></td>
                      <td className="px-3 py-2">{r.name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">
                        <span className={cn('whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium', KIND[r.kind].cls)}>
                          {r.kind === 'missing' && isShelf(r.link) ? (isHe ? 'מדף או אפסים' : 'Shelf / zeros') : (isHe ? KIND[r.kind].he : KIND[r.kind].en)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                        {r.kind === 'missing' ? r.link : r.link.split(', ').map((c, i) => (
                          <span key={c}>{i > 0 && ', '}<ItemLink code={c} showCode copyable={false} /></span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.sold ? Math.round(r.sold) : ''}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.stock ? Math.round(r.stock) : ''}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{isHe ? KIND[r.kind].doHe : KIND[r.kind].doEn}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7} className="p-4 text-center text-sm text-muted-foreground">{isHe ? 'אין שורות' : 'No rows'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
