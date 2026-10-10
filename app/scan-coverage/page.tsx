'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { ScanSearch, RefreshCw, Download } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { seriesColor } from '@/lib/chart-colors'
import type { CoveragePayload } from '@/lib/scan-coverage'
import { useUrlParams } from '@/hooks/use-url-params'

/**
 * Scan coverage — "what share of Israel's active cars can we answer with a scanned
 * catalogue, and how many of those can we also price — for which models?"
 *
 * Everything is computed client-side from one cached payload (~70k model/year rows),
 * so grouping, filtering and drilling are instant.
 */

type Row = CoveragePayload['rows'][number]
type GroupBy = 'importer' | 'brand' | 'manufacturer' | 'tradeName' | 'degem' | 'year' | 'priceSource' | 'status'
type Status = 'sp' | 'sn' | 'np' | 'nn'

const GROUP_LABEL: Record<GroupBy, string> = {
  importer: 'יבואן', brand: 'מותג', manufacturer: 'יצרן + ארץ', tradeName: 'דגם (שם מסחרי)',
  degem: 'קוד דגם', year: 'שנת ייצור', priceSource: 'מקור מחיר', status: 'סטטוס',
}
/** Clicking a row filters to it and steps one level down. */
const NEXT: Record<GroupBy, GroupBy> = {
  importer: 'brand', brand: 'tradeName', manufacturer: 'tradeName', tradeName: 'degem',
  degem: 'year', year: 'brand', priceSource: 'brand', status: 'brand',
}
const STATUS_LABEL: Record<Status, string> = {
  sp: 'נסרק + יש מחיר', sn: 'נסרק, בלי מקור מחיר', np: 'לא נסרק, יש מקור מחיר', nn: 'לא נסרק, בלי מחיר',
}
const STATUS_COLOR: Record<Status, string> = {
  sp: 'var(--success)', sn: 'var(--info)', np: 'var(--warning)', nn: 'var(--muted-foreground)',
}
/** Importers below this share of a group's cars are private/one-off imports — not shown in the row. */
const IMPORTER_MIN_SHARE = 0.02

interface Agg {
  key: string; cars: number; covered: number; gap: number; pct: number; share: number
  models: number; scannedModels: number; pricedPct: number | null
  sources: string[]; importers: string[]
}

/**
 * Every filter lives in the URL, so a view can be linked: /scan-coverage?sort_by=unscanned&group_by=tradeName.
 * Defaults are left out of the URL. Sort keys have readable aliases; the raw Agg keys work too.
 */
const SORT_ALIAS: Record<string, keyof Agg> = {
  name: 'key', cars: 'cars', share: 'share', scanned: 'covered', coverage: 'pct', unscanned: 'gap',
  models: 'models', scanned_models: 'scannedModels', priced: 'pricedPct', sources: 'sources', importers: 'importers',
}
const SORT_NAME = Object.fromEntries(Object.entries(SORT_ALIAS).map(([k, v]) => [v, k])) as Record<keyof Agg, string>
const STATUS_ALIAS: Record<string, 'all' | Status | 's' | 'n'> = { scanned: 's', unscanned: 'n' }
const TYPE_ALIAS: Record<string, 'all' | '1' | '0'> = { all: 'all', private: '1', commercial: '0', '1': '1', '0': '0' }
const TYPE_NAME = { all: 'all', '1': null, '0': 'commercial' } as const
const DRILL_SEP = '|'
const isGroup = (g: string): g is GroupBy => g in GROUP_LABEL
const isStatus = (v: string): v is 'all' | Status | 's' | 'n' => ['all', 's', 'n', 'sp', 'sn', 'np', 'nn'].includes(v)
const intOr = (v: string | null, d: number) => (v !== null && v !== '' && Number.isFinite(+v) ? Math.trunc(+v) : d)

const fmt = (n: number) => n.toLocaleString('he-IL')
const pctOf = (a: number, b: number) => (b ? (100 * a) / b : 0)

// useSearchParams needs a Suspense boundary above it or the build refuses to prerender.
export default function ScanCoveragePage() {
  return <Suspense fallback={<LoadingState />}><ScanCoverage /></Suspense>
}

function ScanCoverage() {
  const qc = useQueryClient()
  const { data, isLoading, error, isFetching } = useQuery<CoveragePayload>({
    queryKey: ['scan-coverage'],
    queryFn: async () => {
      const r = await fetch('/api/analytics/scan-coverage')
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 60 * 1000,
  })
  const refresh = async () => {
    const r = await fetch('/api/analytics/scan-coverage?fresh=1')
    if (r.ok) qc.setQueryData(['scan-coverage'], await r.json())
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="כיסוי סריקות ומחירים"
        description="כמה מהרכבים הפעילים בישראל נסרקו ב־Partly, לכמה מהם יש מחירים — ולאילו דגמים"
        icon={ScanSearch}
        provenance={data ? { source: 'snapshot', asOf: data.asOf, rows: data.rows.length } : undefined}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 me-1 ${isFetching ? 'animate-spin' : ''}`} /> רענון
          </Button>
        }
      />
      {isLoading && <LoadingState />}
      {error && <Card><CardContent className="p-6 text-sm text-destructive">שגיאה בטעינה: {(error as Error).message}</CardContent></Card>}
      {data && <Coverage data={data} />}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">בונה את הדוח (מאגר משרד התחבורה + כל הסריקות) — בפעם הראשונה זה לוקח כדקה.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-24 mb-3" /><Skeleton className="h-8 w-20" /></CardContent></Card>)}
      </div>
      <Skeleton className="h-[320px] w-full" />
    </div>
  )
}

function Coverage({ data }: { data: CoveragePayload }) {
  // Read once from the URL, then written back on every change (replace, no history entry).
  const url = useUrlParams()
  const [q, setQ] = useState(() => url.get('q') ?? '')
  const [groupBy, setGroupBy] = useState<GroupBy>(() => { const g = url.get('group_by') ?? ''; return isGroup(g) ? g : 'brand' })
  const [vehicleType, setVehicleType] = useState<'all' | '1' | '0'>(() => TYPE_ALIAS[url.get('type') ?? ''] ?? '1')
  const [yearFrom, setYearFrom] = useState(() => intOr(url.get('year_from'), 2010))
  const [yearTo, setYearTo] = useState(() => intOr(url.get('year_to'), 2027))
  const [status, setStatus] = useState<'all' | Status | 's' | 'n'>(() => {
    const v = url.get('status') ?? ''; return STATUS_ALIAS[v] ?? (isStatus(v) ? v : 'all')
  })
  const [source, setSource] = useState(() => url.get('source') || 'all')
  const [minCars, setMinCars] = useState(() => intOr(url.get('min_cars'), 0))
  const [sortKey, setSortKey] = useState<keyof Agg>(() => SORT_ALIAS[url.get('sort_by') ?? ''] ?? 'cars')
  const [sortAsc, setSortAsc] = useState(() => {
    const o = url.get('order'); return o ? o === 'asc' : (SORT_ALIAS[url.get('sort_by') ?? ''] === 'key')
  })
  const [drill, setDrill] = useState<Array<[GroupBy, string]>>(() =>
    (url.get('drill') ?? '').split(DRILL_SEP).map(x => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)] as [string, string] })
      .filter((x): x is [GroupBy, string] => isGroup(x[0]) && !!x[1]))

  const { setMany } = url
  useEffect(() => {
    const defaultAsc = sortKey === 'key'
    setMany({
      q: q.trim() || null,
      group_by: groupBy === 'brand' ? null : groupBy,
      type: TYPE_NAME[vehicleType],
      year_from: yearFrom === 2010 ? null : String(yearFrom),
      year_to: yearTo === 2027 ? null : String(yearTo),
      status: status === 'all' ? null : status === 's' ? 'scanned' : status === 'n' ? 'unscanned' : status,
      source: source === 'all' ? null : source,
      min_cars: minCars ? String(minCars) : null,
      sort_by: sortKey === 'cars' ? null : SORT_NAME[sortKey],
      order: sortAsc === defaultAsc ? null : sortAsc ? 'asc' : 'desc',
      drill: drill.length ? drill.map(([g, v]) => `${g}:${v}`).join(DRILL_SEP) : null,
    })
  }, [setMany, q, groupBy, vehicleType, yearFrom, yearTo, status, source, minCars, sortKey, sortAsc, drill])

  const sourceOf = (r: Row) => data.priceSource[data.brands[r[2]]] || ''
  const statusOf = (r: Row): Status => ((r[8] > 0 ? 's' : 'n') + (sourceOf(r) ? 'p' : 'n')) as Status
  const keyOf = (r: Row, g: GroupBy): string => {
    switch (g) {
      case 'importer': return data.importers[r[1]]
      case 'brand': return data.brands[r[2]]
      case 'manufacturer': return data.manufacturers[r[3]]
      case 'tradeName': return `${data.brands[r[2]]} ${data.tradeNames[r[4]]}`
      case 'degem': return `${data.brands[r[2]]} ${data.tradeNames[r[4]]} · ${r[5]}`
      case 'year': return String(r[6])
      case 'priceSource': return sourceOf(r) || 'ללא מקור מחיר'
      case 'status': return STATUS_LABEL[statusOf(r)]
    }
  }

  const sources = useMemo(() => [...new Set(Object.values(data.priceSource).filter(Boolean))].sort(), [data])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.rows.filter(r => {
      if (vehicleType !== 'all' && String(r[0]) !== vehicleType) return false
      if (r[6] < yearFrom || r[6] > yearTo) return false
      const st = statusOf(r)
      if (status !== 'all' && !(status === st || (status.length === 1 && st[0] === status))) return false
      if (source !== 'all') { const s = sourceOf(r); if (source === '__none' ? s : s !== source) return false }
      for (const [g, v] of drill) if (keyOf(r, g) !== v) return false
      if (needle) {
        const hay = `${data.importers[r[1]]} ${data.brands[r[2]]} ${data.manufacturers[r[3]]} ${data.tradeNames[r[4]]} ${r[5]}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, vehicleType, yearFrom, yearTo, status, source, drill])

  const summary = useMemo(() => {
    let total = 0, covered = 0, pricedW = 0, pricedN = 0
    const st: Record<Status, number> = { sp: 0, sn: 0, np: 0, nn: 0 }
    const scannedBrands = new Set<number>()
    for (const r of rows) {
      total += r[7]; st[statusOf(r)] += r[7]
      if (r[8] > 0) { covered += r[7]; scannedBrands.add(r[2]); if (r[9] >= 0) { pricedW += r[9] * r[7]; pricedN += r[7] } }
    }
    let brandCars = 0, brandCovered = 0
    for (const r of rows) if (scannedBrands.has(r[2])) { brandCars += r[7]; if (r[8] > 0) brandCovered += r[7] }
    return { total, covered, st, partsPriced: pricedN ? pricedW / pricedN : 0, brandCars, brandCovered, brands: scannedBrands.size }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const groups = useMemo(() => {
    const m = new Map<string, { cars: number; covered: number; models: Set<string>; scanned: Set<string>; src: Set<string>; imp: Map<string, number>; pw: number; pn: number }>()
    for (const r of rows) {
      const k = keyOf(r, groupBy)
      let x = m.get(k)
      if (!x) { x = { cars: 0, covered: 0, models: new Set(), scanned: new Set(), src: new Set(), imp: new Map(), pw: 0, pn: 0 }; m.set(k, x) }
      const model = `${r[3]}|${r[5]}`
      x.cars += r[7]; x.models.add(model)
      if (r[8] > 0) { x.covered += r[7]; x.scanned.add(model); if (r[9] >= 0) { x.pw += r[9] * r[7]; x.pn += r[7] } }
      const s = sourceOf(r); if (s) x.src.add(s)
      const imp = data.importers[r[1]]; x.imp.set(imp, (x.imp.get(imp) || 0) + r[7])
    }
    const out: Agg[] = []
    for (const [key, x] of m) {
      if (x.cars < minCars) continue
      out.push({
        key, cars: x.cars, covered: x.covered, gap: x.cars - x.covered,
        pct: pctOf(x.covered, x.cars), share: pctOf(x.cars, summary.total),
        models: x.models.size, scannedModels: x.scanned.size,
        pricedPct: x.pn ? x.pw / x.pn : null, sources: [...x.src],
        // Biggest importers first; private one-off importers (a person's name on 3 cars) are noise here.
        importers: [...x.imp.entries()].filter(([, n]) => n / x.cars >= IMPORTER_MIN_SHARE)
          .sort((a, b) => b[1] - a[1]).map(([k]) => k),
      })
    }
    out.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      if (typeof va === 'string' || typeof vb === 'string') return (sortAsc ? 1 : -1) * String(va).localeCompare(String(vb), 'he')
      const na = (va as number | null) ?? -1, nb = (vb as number | null) ?? -1
      return sortAsc ? na - nb : nb - na
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupBy, minCars, sortKey, sortAsc, summary.total])

  const topSlices = (pick: (a: Agg) => number) => {
    const sorted = [...groups].map(g => ({ name: g.key, value: pick(g) })).filter(x => x.value > 0).sort((a, b) => b.value - a.value)
    const head = sorted.slice(0, 7)
    const rest = sorted.slice(7).reduce((s, x) => s + x.value, 0)
    return rest > 0 ? [...head, { name: 'אחר', value: rest }] : head
  }

  const exportCsv = () => {
    const cols: Array<[keyof Agg, string]> = [['key', GROUP_LABEL[groupBy]], ['cars', 'רכבים פעילים'], ['share', '% מהצי'], ['covered', 'נסרקו'], ['pct', '% כיסוי'], ['gap', 'לא נסרקו'], ['models', 'קודי דגם'], ['scannedModels', 'קודי דגם שנסרקו'], ['pricedPct', '% חלקים עם מחיר'], ['sources', 'מקור מחיר'], ['importers', 'יבואן']]
    const esc = (v: unknown) => `"${String(Array.isArray(v) ? v.join('; ') : typeof v === 'number' ? Math.round(v * 10) / 10 : v ?? '').replace(/"/g, '""')}"`
    const csv = '﻿' + cols.map(c => esc(c[1])).join(',') + '\n' + groups.map(g => cols.map(([k]) => esc(g[k])).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `scan-coverage-${groupBy}.csv`
    a.click()
  }

  const reset = () => {
    setQ(''); setGroupBy('brand'); setVehicleType('1'); setYearFrom(2010); setYearTo(2027)
    setStatus('all'); setSource('all'); setMinCars(0); setDrill([]); setSortKey('cars'); setSortAsc(false)
  }
  const sortBy = (k: keyof Agg) => { if (k === sortKey) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(k === 'key') } }

  const s = summary
  return (
    <>
      {/* The three questions this page exists to answer, in words. */}
      <Card>
        <CardContent className="p-5 grid gap-4 md:grid-cols-3">
          <Answer q="כמה אחוז מהרכבים נסרקו?" a={`${pctOf(s.covered, s.total).toFixed(1)}%`}
            d={`${fmt(s.covered)} מתוך ${fmt(s.total)} רכבים פעילים. במותגים שסרקנו בהם לפחות רכב אחד (${s.brands}): ${pctOf(s.brandCovered, s.brandCars).toFixed(1)}%.`} />
          <Answer q="ולכמה מהם יש מחירים?" a={`${pctOf(s.st.sp, s.covered).toFixed(1)}%`}
            d={`${fmt(s.st.sp)} מהרכבים שנסרקו הם ממותג עם מחירון יבואן או מחירי ג׳אן. בסריקות עצמן, בממוצע ${s.partsPriced.toFixed(0)}% מהחלקים מתומחרים.`} />
          <Answer q="לאילו דגמים?" a={`${fmt(groups.length)} ${GROUP_LABEL[groupBy]}`}
            d="בטבלה למטה — קבצו לפי דגם, מיינו לפי '% כיסוי' או 'לא נסרקו', ולחצו על שורה כדי לרדת לרמת פירוט." />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-end text-sm">
          <Field label="חיפוש"><input className="h-9 rounded-md border bg-background px-2 w-56" value={q} onChange={e => setQ(e.target.value)} placeholder="מותג, דגם, יבואן, קוד דגם…" /></Field>
          <Field label="קיבוץ לפי">
            <select className="h-9 rounded-md border bg-background px-2" value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
              {(Object.keys(GROUP_LABEL) as GroupBy[]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
            </select>
          </Field>
          <Field label="סוג רכב">
            <select className="h-9 rounded-md border bg-background px-2" value={vehicleType} onChange={e => setVehicleType(e.target.value as 'all' | '1' | '0')}>
              <option value="all">הכל</option><option value="1">פרטי</option><option value="0">מסחרי</option>
            </select>
          </Field>
          <Field label="משנה"><input type="number" className="h-9 w-24 rounded-md border bg-background px-2" value={yearFrom} onChange={e => setYearFrom(+e.target.value || 0)} /></Field>
          <Field label="עד שנה"><input type="number" className="h-9 w-24 rounded-md border bg-background px-2" value={yearTo} onChange={e => setYearTo(+e.target.value || 9999)} /></Field>
          <Field label="סטטוס">
            <select className="h-9 rounded-md border bg-background px-2" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
              <option value="all">הכל</option><option value="s">נסרק (הכל)</option><option value="sp">{STATUS_LABEL.sp}</option><option value="sn">{STATUS_LABEL.sn}</option>
              <option value="n">לא נסרק (הכל)</option><option value="np">{STATUS_LABEL.np}</option><option value="nn">{STATUS_LABEL.nn}</option>
            </select>
          </Field>
          <Field label="מקור מחיר">
            <select className="h-9 rounded-md border bg-background px-2" value={source} onChange={e => setSource(e.target.value)}>
              <option value="all">הכל</option>{sources.map(x => <option key={x} value={x}>{x}</option>)}<option value="__none">ללא מקור מחיר</option>
            </select>
          </Field>
          <Field label="מינ׳ רכבים בשורה"><input type="number" step={100} className="h-9 w-24 rounded-md border bg-background px-2" value={minCars} onChange={e => setMinCars(+e.target.value || 0)} /></Field>
          <Button variant="outline" size="sm" onClick={reset}>איפוס</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 me-1" />CSV</Button>
        </CardContent>
      </Card>

      {drill.length > 0 && (
        <div className="text-sm flex flex-wrap gap-2 items-center">
          <span className="text-muted-foreground">סינון:</span>
          {drill.map(([g, v], i) => (
            <button key={i} className="text-primary hover:underline" onClick={() => setDrill(drill.slice(0, i + 1))}>{GROUP_LABEL[g]}: <bdi>{v}</bdi> ›</button>
          ))}
          <button className="text-muted-foreground hover:underline" onClick={() => setDrill([])}>נקה</button>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <Kpi label="רכבים פעילים" value={fmt(s.total)} />
        <Kpi label="נסרקו" value={`${pctOf(s.covered, s.total).toFixed(1)}%`} hint={`${fmt(s.covered)} רכבים`} />
        <Kpi label="נסרקו + יש מחיר" value={`${pctOf(s.st.sp, s.total).toFixed(1)}%`} hint={`${fmt(s.st.sp)} רכבים`} />
        <Kpi label="נסרקו, בלי מקור מחיר" value={`${pctOf(s.st.sn, s.total).toFixed(1)}%`} hint={`${fmt(s.st.sn)} רכבים`} />
        <Kpi label="% חלקים מתומחרים בסריקות" value={`${s.partsPriced.toFixed(0)}%`} hint="ממוצע משוקלל לפי רכבים" />
        <Kpi label="לא נסרקו" value={`${pctOf(s.total - s.covered, s.total).toFixed(1)}%`} hint={`${fmt(s.total - s.covered)} רכבים`} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Donut title="סטטוס כיסוי" center={`${pctOf(s.covered, s.total).toFixed(0)}%`}
          slices={(Object.keys(STATUS_LABEL) as Status[]).map(k => ({ name: STATUS_LABEL[k], value: s.st[k], color: STATUS_COLOR[k] }))} />
        <Donut title={`הצי לפי ${GROUP_LABEL[groupBy]}`} slices={topSlices(g => g.cars)} />
        <Donut title={`איפה הפער — לא נסרקו לפי ${GROUP_LABEL[groupBy]}`} slices={topSlices(g => g.gap)} />
        <Donut title={`מה כבר נסרק — לפי ${GROUP_LABEL[groupBy]}`} slices={topSlices(g => g.covered)} />
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto max-h-[75vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b">
                {([
                  ['key', GROUP_LABEL[groupBy]], ['cars', 'רכבים פעילים'], ['share', '% מהצי'], ['covered', 'נסרקו'], ['pct', '% כיסוי'],
                  ['gap', 'לא נסרקו'], ['models', 'קודי דגם'], ['scannedModels', 'נסרקו (קודים)'], ['pricedPct', '% חלקים עם מחיר'],
                  ['sources', 'מקור מחיר'], ['importers', 'יבואן'],
                ] as Array<[keyof Agg, string]>).map(([k, l]) => (
                  <th key={k} onClick={() => sortBy(k)} className="px-3 py-2 text-start font-medium whitespace-nowrap cursor-pointer select-none hover:text-primary">
                    {l}{sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.slice(0, 1500).map(g => (
                <tr key={g.key} className="border-b hover:bg-muted/50 cursor-pointer"
                  onClick={() => { setDrill([...drill, [groupBy, g.key]]); setGroupBy(NEXT[groupBy]) }}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap"><bdi>{g.key}</bdi></td>
                  <td className="px-3 py-2 tabular-nums">{fmt(g.cars)}</td>
                  <td className="px-3 py-2 tabular-nums">{g.share.toFixed(1)}%</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(g.covered)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-block w-28 h-2.5 rounded-full bg-muted align-middle overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${g.pct}%`, background: 'var(--success)' }} />
                    </span>
                    <span className="inline-block w-14 text-end tabular-nums">{g.pct.toFixed(1)}%</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmt(g.gap)}</td>
                  <td className="px-3 py-2 tabular-nums">{g.models}</td>
                  <td className="px-3 py-2 tabular-nums">{g.scannedModels}</td>
                  <td className="px-3 py-2 tabular-nums">{g.pricedPct === null ? <span className="text-muted-foreground">—</span> : `${g.pricedPct.toFixed(0)}%`}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g.sources.length ? g.sources.map(x => <span key={x} className="me-1 rounded-full bg-[color-mix(in_srgb,var(--success)_18%,transparent)] px-2 py-0.5 text-xs">{x}</span>) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{g.importers.slice(0, 2).join(', ')}{g.importers.length > 2 ? ` +${g.importers.length - 2}` : ''}</td>
                </tr>
              ))}
              {groups.length > 1500 && <tr><td colSpan={11} className="px-3 py-2 text-muted-foreground">מוצגות 1,500 שורות מתוך {fmt(groups.length)} — צמצמו עם חיפוש או סינון</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground leading-6">
        <b>שיטה:</b> רכבים פעילים לפי משרד התחבורה (<bdi>data.gov.il</bdi>), יבואן לפי מאגר מחירי הרכב שלו. רכב נחשב &quot;נסרק&quot; כשקוד הדגם המדויק שלו (<bdi>degem_nm</bdi>) של אותו יצרן נסרק ב־<bdi>Partly</bdi> —
        הערכה שמרנית: גימור או שנה בקוד דגם שכן נספרים כלא נסרקו. &quot;מקור מחיר&quot; = מחירון יבואן ב־<bdi>Partly</bdi> או מחירי ג׳אן (<bdi>ERP</bdi>).
        &quot;% חלקים עם מחיר&quot; = מתוך מק״טי הסריקות של הדגם, כמה נמצאים במחירון יבואן או נמכרים אצל ג׳אן. יבואנים קטנים (פחות מ־2% מהרכבים בשורה) לא מוצגים. סה״כ סריקות ב־<bdi>Partly</bdi>: {fmt(data.scans)}.
      </p>
    </>
  )
}

function Answer({ q, a, d }: { q: string; a: string; d: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{q}</div>
      <div className="text-3xl font-bold tabular-nums mt-1">{a}</div>
      <div className="text-xs text-muted-foreground mt-1 leading-5">{d}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-muted-foreground">{label}{children}</label>
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </CardContent></Card>
  )
}

function Donut({ title, slices, center }: { title: string; slices: Array<{ name: string; value: number; color?: string }>; center?: string }) {
  const total = slices.reduce((t, x) => t + x.value, 0) || 1
  const colorOf = (x: { name: string; color?: string }, i: number) => x.color ?? (x.name === 'אחר' ? 'var(--muted-foreground)' : seriesColor(i))
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-[130px_1fr] items-center gap-3">
        <div className="relative h-[130px]">
          <ResponsiveContainer width="100%" height={130}>
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius={38} outerRadius={62} stroke="var(--card)" isAnimationActive={false}>
                {slices.map((x, i) => <Cell key={x.name} fill={colorOf(x, i)} />)}
              </Pie>
              <Tooltip formatter={(v: unknown, n: unknown) => [`${fmt(Number(v))} (${((100 * Number(v)) / total).toFixed(1)}%)`, String(n)]} />
            </PieChart>
          </ResponsiveContainer>
          {center && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-semibold">{center}</div>}
        </div>
        <ul className="space-y-1 text-xs min-w-0">
          {slices.map((x, i) => (
            <li key={x.name} className="flex items-center gap-1.5 min-w-0">
              <span className="h-2.5 w-2.5 rounded-sm flex-none" style={{ background: colorOf(x, i) }} />
              <span className="line-clamp-2 break-words" title={x.name}><bdi>{x.name}</bdi></span>
              <span className="ms-auto tabular-nums text-muted-foreground whitespace-nowrap">{((100 * x.value) / total).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
