'use client'

import { useEffect, useMemo, useState } from 'react'
import { ItemLink } from '@/components/shared/ItemLink'

type Row = {
  code: string; name: string; size: 'small' | 'medium'
  price: number; stock: number; sold_this_year: number; sold_2025: number; sold_2024: number
  demand: number; years_of_stock: number; match: number
}
type Payload = {
  count: number; small: number; medium: number
  avg_price: number; capital_tied: number; items: Row[]
}

const PER = 50
const nf = (n: number) => n.toLocaleString('en-US')

type SortKey = keyof Row
const NUMERIC: SortKey[] = ['price', 'stock', 'sold_this_year', 'sold_2025', 'sold_2024', 'demand', 'years_of_stock', 'match']

export default function EbayRecoPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [size, setSize] = useState<'' | 'small' | 'medium'>('')
  const [sortKey, setSortKey] = useState<SortKey>('match')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetch('/api/analytics/ebay-recommend')
      .then(r => r.json())
      .then(d => (d.error ? setErr(d.error) : setData(d)))
      .catch(e => setErr(String(e)))
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const term = q.trim()
    const filtered = data.items.filter(
      r => (!size || r.size === size) && (!term || r.name.includes(term) || r.code.includes(term)),
    )
    filtered.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey]
      if (typeof x === 'string' && typeof y === 'string') return sortDir * x.localeCompare(y, 'he')
      return sortDir * ((x as number) - (y as number))
    })
    return filtered
  }, [data, q, size, sortKey, sortDir])

  const pages = Math.max(1, Math.ceil(rows.length / PER))
  const cur = Math.min(page, pages - 1)
  const slice = rows.slice(cur * PER, cur * PER + PER)

  function sortBy(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(NUMERIC.includes(k) ? -1 : 1) }
    setPage(0)
  }

  if (err) return <div className="p-4 text-red-500">שגיאה בטעינה: {err}</div>
  if (!data) return <div className="p-6 text-muted-foreground">טוען מומלצים…</div>

  const Th = ({ k, children, className = '' }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      onClick={k ? () => sortBy(k) : undefined}
      className={`px-3 py-2.5 text-right text-xs font-bold text-muted-foreground whitespace-nowrap bg-muted/40 border-b sticky top-0 ${k ? 'cursor-pointer select-none hover:text-foreground' : ''} ${className}`}
    >
      {children}{k && sortKey === k ? <span className="text-primary ms-1 text-[10px]">{sortDir < 0 ? '▼' : '▲'}</span> : null}
    </th>
  )

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-bold text-primary mb-1">רשימת מכירה ל-eBay — לוגיקה חדשה</div>
        <h1 className="text-2xl font-bold">מלאי מת ויקר שקל לשלוח — למכירה ב-eBay</h1>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1">
          ציון ההתאמה (0–100) = מדד ״מלאי מת״ 45% + מחיר 25% + כמות במלאי 15% + קלות משלוח (קטן&gt;בינוני) 15%.
          מדד המלאי-המת שוקל בעיקר את <b>השנה הנוכחית</b>: 70% לפי מכירות 2026 · 20% לפי 2025 · 10% שנות מלאי — פריט שנמכר השנה איננו מת. מחיר גבוה, כמות גדולה במלאי וגודל קטן מעלים את הציון. מסונן: קטן/בינוני, מחיר ≥ ₪1,000, יש מלאי.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          ['מועמדים', nf(data.count)],
          ['קטנים · בינוניים', `${nf(data.small)} · ${nf(data.medium)}`],
          ['מחיר ממוצע', `₪${nf(data.avg_price)}`],
          ['הון תקוע', `₪${nf(data.capital_tied)}`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border bg-card p-3.5">
            <div className="text-xs text-muted-foreground mb-1">{l}</div>
            <div className="text-xl font-bold tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2.5 items-center">
        <input
          value={q} onChange={e => { setQ(e.target.value); setPage(0) }}
          placeholder="חיפוש לפי שם או קוד פריט…"
          className="flex-1 min-w-[180px] rounded-lg border bg-muted/40 px-3 py-2 text-sm"
        />
        <select
          value={size} onChange={e => { setSize(e.target.value as any); setPage(0) }}
          className="rounded-lg border bg-muted/40 px-3 py-2 text-sm"
        >
          <option value="">כל הגדלים</option>
          <option value="small">קטן בלבד</option>
          <option value="medium">בינוני בלבד</option>
        </select>
        <span className="ms-auto text-sm text-muted-foreground">{nf(rows.length)} פריטים</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr>
              <Th>#</Th>
              <Th k="code">קוד פריט</Th>
              <Th k="name">שם</Th>
              <Th k="size">גודל</Th>
              <Th k="price">מחיר</Th>
              <Th k="sold_this_year">נמכר 26׳</Th>
              <Th k="sold_2025">נמכר 25׳</Th>
              <Th k="sold_2024">נמכר 24׳</Th>
              <Th k="stock">מלאי</Th>
              <Th k="years_of_stock">שנות מלאי</Th>
              <Th k="match">ציון התאמה</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={r.code} className="border-b hover:bg-muted/40">
                <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{cur * PER + i + 1}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground" dir="ltr" style={{ textAlign: 'right' }}>
                  <ItemLink code={r.code} />
                </td>
                <td className="px-3 py-2 min-w-[220px]">{r.name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${r.size === 'small' ? 'text-emerald-600 bg-emerald-500/15' : 'text-amber-600 bg-amber-500/15'}`}>
                    {r.size === 'small' ? 'קטן' : 'בינוני'}
                  </span>
                </td>
                <td className="px-3 py-2 font-bold tabular-nums whitespace-nowrap" dir="ltr" style={{ textAlign: 'right' }}>₪{nf(r.price)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.sold_this_year}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.sold_2025}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.sold_2024}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{r.stock}</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold">{r.years_of_stock >= 100 ? '∞' : r.years_of_stock}</td>
                <td className="px-3 py-2 min-w-[96px]">
                  <div className="font-bold tabular-nums">{r.match}</div>
                  <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${r.match}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="flex gap-2 items-center justify-center">
        <button disabled={cur <= 0} onClick={() => setPage(cur - 1)} className="rounded-lg border bg-muted/40 px-4 py-1.5 text-sm disabled:opacity-40">‹ הקודם</button>
        <span className="text-sm text-muted-foreground tabular-nums">
          עמוד {cur + 1} מתוך {pages} · מציג {rows.length ? cur * PER + 1 : 0}–{Math.min(cur * PER + PER, rows.length)}
        </span>
        <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="rounded-lg border bg-muted/40 px-4 py-1.5 text-sm disabled:opacity-40">הבא ›</button>
      </div>

      <p className="text-xs text-muted-foreground/70 max-w-3xl">
        הגודל מסווג אוטומטית משם הפריט בעברית. נתוני מכירות: מוני 7IPQ של ה-ERP (מדויקים, מנוכי ביטולים) — 2025 מ-FINAPI, 2024 מטבלת yearly_item_sales.
      </p>
    </div>
  )
}
