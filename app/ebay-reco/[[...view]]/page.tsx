'use client'

import { useEffect, useMemo, useState, Suspense } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useUrlParams } from '@/hooks/use-url-params'
import { ItemLink } from '@/components/shared/ItemLink'
import { SubTabs } from '@/components/shared/SubTabs'
import { LiquidationMap } from '../LiquidationMap'
import { formatCurrency } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'

type Row = {
  code: string; name: string; size: 'small' | 'medium'
  price: number; stock: number; sold_this_year: number; sold_2025: number; sold_2024: number
  demand: number; years_of_stock: number; deadness: number; match: number
  first_seen_year: number | null; age_years: number | null
  ebay_ils: number | null; ebay_market: string | null; ebay_flag: string
  ebay_match_count: number | null; ebay_spread_pct: number | null
  ebay_oem: boolean | null; ebay_url: string | null
}
type Payload = {
  count: number; small: number; medium: number
  avg_price: number; capital_tied: number; items: Row[]
}

const PER = 50
const nf = (n: number) => n.toLocaleString('en-US')
const UPLOADER_RECO_URL = `${process.env.NEXT_PUBLIC_EBAY_UPLOADER_URL || 'http://192.168.0.112:3003'}/batch-editor?tab=recommended`

type SortKey = keyof Row
const NUMERIC: SortKey[] = ['price', 'stock', 'sold_this_year', 'sold_2025', 'sold_2024', 'demand', 'years_of_stock', 'match', 'age_years', 'ebay_ils']

// Readable ?sort_by= values ↔ internal column keys, so links are shareable and
// intuitive, e.g. ?sort_by=ebay&sort_dir=desc · ?sort_by=stock_years · ?sort_by=sold_26.
const SORT_PARAMS: Array<{ param: string; key: SortKey }> = [
  { param: 'match', key: 'match' },
  { param: 'price', key: 'price' },
  { param: 'ebay', key: 'ebay_ils' },
  { param: 'stock', key: 'stock' },
  { param: 'stock_years', key: 'years_of_stock' },
  { param: 'age', key: 'age_years' },
  { param: 'sold_26', key: 'sold_this_year' },
  { param: 'sold_25', key: 'sold_2025' },
  { param: 'sold_24', key: 'sold_2024' },
  { param: 'demand', key: 'demand' },
  { param: 'code', key: 'code' },
  { param: 'name', key: 'name' },
  { param: 'size', key: 'size' },
]
const PARAM_TO_SORT = new Map<string, SortKey>(SORT_PARAMS.map(s => [s.param, s.key]))
for (const s of SORT_PARAMS) if (!PARAM_TO_SORT.has(s.key)) PARAM_TO_SORT.set(s.key, s.key) // also accept raw keys
const SORT_TO_PARAM = new Map<SortKey, string>(SORT_PARAMS.map(s => [s.key, s.param]))
const DEFAULT_SORT: SortKey = 'match'

function EbayRecoContent() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  // view is driven by the URL (/ebay-reco/table · /ebay-reco/map) so it is
  // bookmarkable and shareable. This is an optional-catch-all route, so switching
  // between table and map is a param-only change — the page does NOT remount, the
  // fetched data + filter state below persist (no re-fetch of the 2,645 items).
  const pathname = usePathname()
  const router = useRouter()
  const view: 'table' | 'map' = pathname.endsWith('/map') ? 'map' : 'table'
  // Preserve the query string (filters) when switching table↔map. Read it fresh
  // at click time — a render-time capture can be stale before the URL flush.
  const goTo = (v: 'table' | 'map') =>
    router.push(`/ebay-reco/${v}${typeof window !== 'undefined' ? window.location.search : ''}`, { scroll: false })

  // Filters are mirrored to the URL query string so a filtered view is shareable
  // (e.g. /ebay-reco/table?min_age=4&size=small&q=טורבו). Initialized from the URL.
  const { get, set } = useUrlParams()
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState(() => get('q') || '')
  const [size, setSize] = useState<'' | 'small' | 'medium'>(() => {
    const s = get('size'); return s === 'small' || s === 'medium' ? s : ''
  })
  // Minimum age (years in system) — hides parts newer than this. 0 = off.
  // Parts with unknown age (no sales on record since 2020) are kept.
  const [minAge, setMinAge] = useState(() => Math.max(0, Number(get('min_age')) || 0))
  const [sortKey, setSortKey] = useState<SortKey>(() => PARAM_TO_SORT.get(get('sort_by') || '') || DEFAULT_SORT)
  const [sortDir, setSortDir] = useState<1 | -1>(() => {
    const d = get('sort_dir')
    if (d === 'asc') return 1
    if (d === 'desc') return -1
    // No explicit direction → the column's natural default (numeric = high→low).
    const k = PARAM_TO_SORT.get(get('sort_by') || '') || DEFAULT_SORT
    return NUMERIC.includes(k) ? -1 : 1
  })
  const [page, setPage] = useState(0)

  // Multi-select → send to the eBay uploader as pending suggestions (both apps
  // share the Neon DB; the API route inserts into ebay_uploader.recommendations).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<
    { added: number; skipped_listed: string[]; skipped_recommended: string[]; ai_queued?: boolean; error?: string } | null
  >(null)
  // code → 'added' (new suggestion) | 'exists' (already listed / already suggested)
  const [sentCodes, setSentCodes] = useState<Map<string, 'added' | 'exists'>>(new Map())

  useEffect(() => {
    fetch('/api/analytics/ebay-recommend')
      .then(r => r.json())
      .then(d => (d.error ? setErr(d.error) : setData(d)))
      .catch(e => setErr(String(e)))
    // Badge parts that are already in the uploader (open suggestion or listed item)
    fetch('/api/ebay/send-to-uploader')
      .then(r => r.json())
      .then(d => {
        const m = new Map<string, 'added' | 'exists'>()
        for (const c of [...(d.recommended || []), ...(d.listed || [])]) m.set(c, 'exists')
        if (m.size) setSentCodes(prev => new Map([...m, ...prev]))
      })
      .catch(() => { /* badge info is best-effort */ })
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const term = q.trim()
    const filtered = data.items.filter(
      r => (!size || r.size === size)
        && (!term || r.name.includes(term) || r.code.includes(term))
        // Age filter: keep only parts proven older than the threshold. Unknown age
        // (null) is kept — we never hide potential dead stock we can't date.
        && (minAge <= 0 || r.age_years === null || r.age_years > minAge),
    )
    filtered.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey]
      if (typeof x === 'string' && typeof y === 'string') return sortDir * x.localeCompare(y, 'he')
      // Nulls (unknown age) sort to the end regardless of direction.
      if (x === null) return 1
      if (y === null) return -1
      return sortDir * ((x as number) - (y as number))
    })
    return filtered
  }, [data, q, size, minAge, sortKey, sortDir])

  const pages = Math.max(1, Math.ceil(rows.length / PER))
  const cur = Math.min(page, pages - 1)
  const slice = rows.slice(cur * PER, cur * PER + PER)

  function toggleOne(code: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function sendToUploader() {
    if (!data || selected.size === 0 || sending) return
    setSending(true)
    setSendResult(null)
    try {
      const items = data.items
        .filter(r => selected.has(r.code))
        .map(r => ({
          code: r.code, name: r.name, price: r.price, stock: r.stock,
          sold_this_year: r.sold_this_year, sold_2025: r.sold_2025, sold_2024: r.sold_2024,
          match: r.match, years_of_stock: r.years_of_stock,
          ebay_ils: r.ebay_ils, ebay_url: r.ebay_url,
        }))
      const res = await fetch('/api/ebay/send-to-uploader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || res.statusText)
      setSentCodes(prev => {
        const next = new Map(prev)
        for (const c of d.added_codes || []) next.set(c, 'added')
        for (const c of [...(d.skipped_listed || []), ...(d.skipped_recommended || [])]) next.set(c, 'exists')
        return next
      })
      setSendResult(d)
      setSelected(new Set())
    } catch (e) {
      setSendResult({ added: 0, skipped_listed: [], skipped_recommended: [], error: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  function sortBy(k: SortKey) {
    const nextDir: 1 | -1 = sortKey === k ? (sortDir === 1 ? -1 : 1) : (NUMERIC.includes(k) ? -1 : 1)
    setSortKey(k)
    setSortDir(nextDir)
    setPage(0)
    // Mirror to the URL (shareable). Drop the params when back at the default
    // (match, high→low) to keep links clean.
    const isDefault = k === DEFAULT_SORT && nextDir === -1
    set('sort_by', isDefault ? null : (SORT_TO_PARAM.get(k) || k))
    set('sort_dir', isDefault ? null : (nextDir === 1 ? 'asc' : 'desc'))
  }

  if (err) return <div className="p-4 text-red-500">שגיאה בטעינה: {err}</div>
  if (!data) return <div className="p-6 text-muted-foreground">טוען מומלצים…</div>

  const Th = ({ k, children, className = '' }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      onClick={k ? () => sortBy(k) : undefined}
      className={`px-3 py-2.5 text-right text-xs font-bold text-muted-foreground whitespace-nowrap bg-card border-b sticky top-0 z-10 ${k ? 'cursor-pointer select-none hover:text-foreground' : ''} ${className}`}
    >
      {children}{k && sortKey === k ? <span className="text-primary ms-1 text-[10px]">{sortDir < 0 ? '▼' : '▲'}</span> : null}
    </th>
  )

  return (
    <div className="space-y-5">
      <SubTabs tabs={[
        { href: '/ebay', label: 'eBay' },
        { href: '/ebay-reco/table', label: 'eBay חכם' },
      ]} />
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
          ['מחיר ממוצע', formatCurrency(data.avg_price)],
          ['הון תקוע', formatCurrency(data.capital_tied)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border bg-card p-3.5">
            <div className="text-xs text-muted-foreground mb-1">{l}</div>
            <div className="text-xl font-bold tabular-nums" dir="ltr" style={{ textAlign: 'right' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2.5 items-center">
        <div className="flex rounded-lg border overflow-hidden text-sm">
          <button onClick={() => goTo('table')} className={`px-3.5 py-2 ${view === 'table' ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted/40'}`}>טבלה</button>
          <button onClick={() => goTo('map')} className={`px-3.5 py-2 ${view === 'map' ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted/40'}`}>מפה</button>
        </div>
        <input
          value={q} onChange={e => { setQ(e.target.value); set('q', e.target.value || null); setPage(0) }}
          placeholder="חיפוש לפי שם או קוד פריט…"
          className="flex-1 min-w-[180px] rounded-lg border bg-muted/40 px-3 py-2 text-sm"
        />
        <select
          value={size} onChange={e => { setSize(e.target.value as any); set('size', e.target.value || null); setPage(0) }}
          className="rounded-lg border bg-muted/40 px-3 py-2 text-sm"
        >
          <option value="">כל הגדלים</option>
          <option value="small">קטן בלבד</option>
          <option value="medium">בינוני בלבד</option>
        </select>
        <label
          className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-sm whitespace-nowrap"
          title="הסתרת פריטים חדשים — מציג רק כאלה שקיימים במערכת יותר משנים אלו (לפי כל הצ׳יין). פריטים ללא היסטוריית מכירות מ-2020 נשארים."
        >
          <span className="text-muted-foreground">ותק מינ׳ (שנים)</span>
          <input
            type="number" min={0} inputMode="numeric"
            value={minAge || ''} onChange={e => { const v = Math.max(0, Number(e.target.value) || 0); setMinAge(v); set('min_age', v > 0 ? String(v) : null); setPage(0) }}
            placeholder="הכל"
            className="w-14 bg-transparent text-center tabular-nums outline-none"
          />
        </label>
        <span className="ms-auto text-sm text-muted-foreground">{nf(rows.length)} פריטים</span>
        {selected.size > 0 && (
          <button
            onClick={sendToUploader}
            disabled={sending}
            className="rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-sm font-bold disabled:opacity-50"
          >
            {sending ? 'שולח…' : `שלח ל-eBay Uploader (${nf(selected.size)})`}
          </button>
        )}
      </div>

      {/* Send-to-uploader result */}
      {sendResult && (
        sendResult.error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            השליחה ל-eBay Uploader נכשלה: {sendResult.error}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
            <span className="font-bold text-emerald-600">✓ נוספו {nf(sendResult.added)} הצעות ל-eBay Uploader</span>
            <a
              href={UPLOADER_RECO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-primary hover:underline"
            >
              פתח ב-eBay Uploader ↗
            </a>
            {sendResult.added > 0 && sendResult.ai_queued && (
              <span className="text-muted-foreground">תוכן AI (כותרת ותיאור) נוצר ברקע</span>
            )}
            {sendResult.skipped_listed.length > 0 && (
              <span className="text-muted-foreground" title={sendResult.skipped_listed.join(', ')}>
                {nf(sendResult.skipped_listed.length)} דולגו — כבר קיימים ב-Uploader
              </span>
            )}
            {sendResult.skipped_recommended.length > 0 && (
              <span className="text-muted-foreground" title={sendResult.skipped_recommended.join(', ')}>
                {nf(sendResult.skipped_recommended.length)} דולגו — כבר ממתינים כהצעה
              </span>
            )}
            <button onClick={() => setSendResult(null)} className="ms-auto text-muted-foreground hover:text-foreground">✕</button>
          </div>
        )
      )}

      {/* Map view */}
      {view === 'map' && <LiquidationMap rows={rows} />}

      {/* Table */}
      {view === 'table' && (<>
      <div className="overflow-auto rounded-xl border max-h-[calc(100vh-24rem)]">
        <table className="w-full text-sm min-w-[1180px]">
          <thead>
            <tr>
              <Th className="w-9">
                <input
                  type="checkbox"
                  aria-label="בחר את כל העמוד"
                  className="accent-primary cursor-pointer"
                  checked={slice.length > 0 && slice.every(r => selected.has(r.code))}
                  onChange={() => {
                    const all = slice.every(r => selected.has(r.code))
                    setSelected(prev => {
                      const next = new Set(prev)
                      for (const r of slice) { if (all) next.delete(r.code); else next.add(r.code) }
                      return next
                    })
                  }}
                />
              </Th>
              <Th>#</Th>
              <Th k="code">קוד פריט</Th>
              <Th k="name">שם</Th>
              <Th k="size">גודל</Th>
              <Th k="price">מחיר</Th>
              <Th k="ebay_ils">eBay (חדש, הכי גבוה)</Th>
              <Th k="sold_this_year">נמכר 26׳</Th>
              <Th k="sold_2025">נמכר 25׳</Th>
              <Th k="sold_2024">נמכר 24׳</Th>
              <Th k="stock">מלאי</Th>
              <Th k="years_of_stock">שנות מלאי</Th>
              <Th k="age_years">ותק במערכת</Th>
              <Th k="match">ציון התאמה</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={r.code} className={`border-b hover:bg-muted/40 ${selected.has(r.code) ? 'bg-primary/5' : ''}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`בחר ${r.code}`}
                    className="accent-primary cursor-pointer"
                    checked={selected.has(r.code)}
                    onChange={() => toggleOne(r.code)}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{cur * PER + i + 1}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground" dir="ltr" style={{ textAlign: 'right' }}>
                  <ItemLink code={r.code} />
                </td>
                <td className="px-3 py-2 min-w-[220px]">
                  {r.name}
                  {sentCodes.get(r.code) === 'added' && (
                    <span className="ms-2 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full text-emerald-600 bg-emerald-500/15" title="נוסף כהצעה ב-eBay Uploader">נשלח ✓</span>
                  )}
                  {sentCodes.get(r.code) === 'exists' && (
                    <span className="ms-2 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full text-muted-foreground bg-muted" title="כבר קיים ב-eBay Uploader (פריט או הצעה ממתינה)">קיים ב-Uploader</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${r.size === 'small' ? 'text-emerald-600 bg-emerald-500/15' : 'text-amber-600 bg-amber-500/15'}`}>
                    {r.size === 'small' ? 'קטן' : 'בינוני'}
                  </span>
                </td>
                <td className="px-3 py-2 font-bold tabular-nums whitespace-nowrap" dir="ltr" style={{ textAlign: 'right' }}>{formatCurrency(r.price)}</td>
                <td className="px-3 py-2 whitespace-nowrap" dir="ltr" style={{ textAlign: 'right' }}>
                  {r.ebay_ils == null ? (
                    <span className="text-muted-foreground/40" title="טרם נבדק ב-eBay, או אין התאמה חדשה">—</span>
                  ) : (() => {
                    const inner = (
                      <>
                        <span className="font-bold tabular-nums">{formatCurrency(r.ebay_ils)}</span>
                        <span className="ms-1">{r.ebay_flag}</span>
                        {r.ebay_oem && <span className="ms-1 text-[10px] font-bold text-sky-500" title="השוואה מול חלק מקורי/OEM">OEM</span>}
                        {r.ebay_spread_pct != null && (
                          <span className={`ms-1 text-[11px] font-semibold tabular-nums ${r.ebay_spread_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {r.ebay_spread_pct >= 0 ? '+' : ''}{r.ebay_spread_pct}%
                          </span>
                        )}
                        {(r.ebay_match_count ?? 0) < 3 && (
                          <span className="ms-1 text-[10px] text-amber-500" title="מעט התאמות — ביטחון נמוך">⚠</span>
                        )}
                      </>
                    )
                    const tip = `${r.ebay_market} · ${r.ebay_match_count} התאמות${r.ebay_oem ? ' (מקורי)' : ''}${r.ebay_url ? ' · פתח ב-eBay ↗' : ''}`
                    return r.ebay_url
                      ? <a href={r.ebay_url} target="_blank" rel="noopener noreferrer" title={tip} className="inline-flex items-center hover:underline decoration-dotted">{inner}</a>
                      : <span title={tip}>{inner}</span>
                  })()}
                </td>
                <td className="px-3 py-2 text-center tabular-nums">{r.sold_this_year}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.sold_2025}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.sold_2024}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{r.stock}</td>
                <td className="px-3 py-2 text-center tabular-nums font-semibold">{r.years_of_stock >= 100 ? '∞' : r.years_of_stock}</td>
                <td className="px-3 py-2 text-center tabular-nums whitespace-nowrap">
                  {r.age_years === null
                    ? <span className="text-muted-foreground/50" title="אין היסטוריית מכירות מ-2020 — ותק לא ידוע">—</span>
                    : <span title={r.first_seen_year ? `נראה לראשונה: ${r.first_seen_year}` : undefined}>
                        {r.age_years >= 6 ? '6+' : r.age_years}
                      </span>}
                </td>
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
      </>)}

      <p className="text-xs text-muted-foreground/70 max-w-3xl">
        הגודל מסווג אוטומטית משם הפריט בעברית. נתוני מכירות: מוני 7IPQ של ה-ERP (מדויקים, מנוכי ביטולים) — 2025 מ-FINAPI, 2024 מטבלת yearly_item_sales.
        ״ותק במערכת״ = מספר השנים מאז המכירה הראשונה שנרשמה (על פני כל קודי הצ׳יין) — נתונים מ-2020 ומעלה, לכן ותק מוצג עד ״6+״. פריט ללא מכירות מאז 2020 מסומן ״—״ (ותק לא ידוע) ואינו מוסתר ע״י הסינון.
      </p>
    </div>
  )
}

// useSearchParams (via useUrlParams) requires a Suspense boundary.
export default function EbayRecoPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">טוען מומלצים…</div>}>
      <EbayRecoContent />
    </Suspense>
  )
}
