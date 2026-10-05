'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Store, ExternalLink, Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useGalgalim, useRunGalgalim, useSetGalgalimInterval, type GgRequest } from '@/lib/galgalim'

const FLOOR = 'https://halafim.galgalim.co.il/%D7%9E%D7%95%D7%9B%D7%A8/%D7%96%D7%99%D7%A8%D7%AA%D7%94%D7%9E%D7%A1%D7%97%D7%A8.aspx'
const OUTCOME: Record<GgRequest['outcome'], { he: string; cls: string }> = {
  offer: { he: 'להציע', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  not_stocked: { he: 'לא במלאי', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  not_found: { he: 'לא נמצא', cls: 'bg-muted text-muted-foreground' },
  error: { he: 'שגיאה', cls: 'bg-destructive/15 text-destructive' },
  backlog: { he: 'ישן', cls: 'bg-muted text-muted-foreground' },
}
const SOURCE: Record<string, string> = { 'כן': 'במלאי', 'לובינסקי': 'לובינסקי' }
/** The floor scrolled to this request: a text fragment on its VIN or plate (the site has no per-request URL). */
const floorLink = (r: GgRequest) => (r.vin || r.plate ? `${FLOOR}#:~:text=${encodeURIComponent(r.vin || r.plate)}` : FLOOR)
const select = 'rounded-md border bg-background px-3 py-2 text-sm'
const ago = (t: number | null) => (t ? `${Math.max(0, Math.round((Date.now() / 1000 - t) / 60))} דק׳` : '—')
const inMin = (t?: number | null) => {
  if (!t) return '—'
  const m = Math.max(0, Math.round((t - Date.now() / 1000) / 60))
  return m >= 90 ? `${Math.round(m / 60)} שע׳` : `${m} דק׳`
}
const INTERVALS: [number, string][] = [[900, 'כל 15 דקות'], [3600, 'כל שעה'], [14400, 'כל 4 שעות'], [43200, 'כל 12 שעות'], [86400, 'פעם ביום']]
/** "05/10/2026 08:22" -> sortable number */
const when = (s: string) => {
  const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)/.exec(s || '')
  return m ? Number(`${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}`) : 0
}
const price = (r: GgRequest) => Number(String(r.suggestion?.['מחיר'] ?? '').replace(/[^\d.]/g, '')) || 0

type Key = 'q' | 'outcome' | 'make' | 'ctype' | 'cond' | 'days' | 'sort_by' | 'order' | 'page' | 'size'
const SORTS: Record<string, (r: GgRequest) => string | number> = {
  time: (r) => when(r.date),
  customer: (r) => `${r.ctype} ${r.location}`,
  car: (r) => `${r.make} ${r.model} ${r.year}`,
  part: (r) => r.part,
  offer: price,
  status: (r) => r.outcome,
}

export default function GalgalimPage() {
  return <Suspense fallback={<Skeleton className="h-64" />}><Galgalim /></Suspense>
}

/**
 * Galgalim trading-floor requests and what Diego v2 found for them (owner, 2026-10-05: "do we have this in the
 * dashboard as well so we can track? show the current week's messages in a table" ... "enable search, filter,
 * sort, pagination"). Read-only: the agent on .231 does the work and posts the staff cards to the DiegoV2
 * Telegram group; nothing here sends offers. Every filter lives in the URL, like /bots/[id]/conversations.
 */
function Galgalim() {
  const sp = useSearchParams()
  const router = useRouter()
  const get = (k: Key) => sp.get(k) ?? ''
  const q = get('q'), outcome = get('outcome'), make = get('make'), ctype = get('ctype'), cond = get('cond')
  const days = [7, 14, 30, 90].includes(Number(get('days'))) ? Number(get('days')) : 7
  const sortBy = SORTS[get('sort_by')] ? get('sort_by') : 'time'
  const order = get('order') === 'asc' ? 'asc' : 'desc'
  const size = [25, 50, 100].includes(Number(get('size'))) ? Number(get('size')) : 25
  const page = Math.max(0, Number(get('page') || 1) - 1)
  const setParams = (patch: Partial<Record<Key, string>>, keepPage = false) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    if (!keepPage) next.delete('page')
    if (next.get('sort_by') === 'time') next.delete('sort_by')
    if (next.get('order') === 'desc') next.delete('order')
    if (next.get('size') === '25') next.delete('size')
    if (next.get('days') === '7') next.delete('days')
    const qs = next.toString()
    router.replace(`/galgalim${qs ? `?${qs}` : ''}`, { scroll: false })
  }
  const [typed, setTyped] = useState(q)
  const { data, isLoading, error, isFetching } = useGalgalim(days)
  const all = useMemo(() => (data?.items ?? []).filter((r) => r.outcome !== 'backlog'), [data])
  const makes = useMemo(() => [...new Set(all.map((r) => r.make).filter(Boolean))].sort(), [all])
  const ctypes = useMemo(() => [...new Set(all.map((r) => r.ctype).filter(Boolean))].sort(), [all])
  const conds = useMemo(() => [...new Set(all.flatMap((r) => r.condition ?? []).filter(Boolean))].sort(), [all])
  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    const rows = all
      .filter((r) => !outcome || r.outcome === outcome)
      .filter((r) => !make || r.make === make)
      .filter((r) => !ctype || r.ctype === ctype)
      // a request accepts several conditions ("משומש / חדש תחליפי"): it matches when the chosen one is among them
      .filter((r) => !cond || (r.condition ?? []).includes(cond))
      .filter((r) => !needle || JSON.stringify(r).toLowerCase().includes(needle))
    const key = SORTS[sortBy]
    return [...rows].sort((a, b) => {
      const x = key(a), y = key(b)
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'he')
      return order === 'asc' ? c : -c
    })
  }, [all, q, outcome, make, ctype, cond, sortBy, order])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of all) c[r.outcome] = (c[r.outcome] ?? 0) + 1
    return c
  }, [all])
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const shown = filtered.slice(page * size, page * size + size)
  const st = data?.status
  const setInterval_ = useSetGalgalimInterval()
  const runNow = useRunGalgalim()
  const sortHead = (key: string, label: string) => (
    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={() => setParams({ sort_by: key, order: sortBy === key && order === 'desc' ? 'asc' : 'desc' })}>
      {label}
      {sortBy !== key ? <ArrowUpDown className="h-3 w-3 opacity-50" /> : order === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
    </button>
  )
  const anyFilter = q || outcome || make || ctype || cond

  return (
    <div className="space-y-4" dir="rtl">
      <PageHeader icon={Store} title="גלגלים" description="בקשות מזירת המסחר של גלגלים ומה דייגו v2 מצא — כרטיס לכל בקשה נשלח לקבוצת DiegoV2" />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['offer', 'not_stocked', 'not_found', 'error'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setParams({ outcome: outcome === k ? '' : k })}
                  className={`rounded-md px-2.5 py-1 ${OUTCOME[k].cls} ${outcome === k ? 'ring-2 ring-primary' : ''}`}>
            {OUTCOME[k].he} · {counts[k] ?? 0}
          </button>
        ))}
        <div className="ms-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>בדיקת גלגלים:</span>
          <select className="rounded-md border bg-background px-2 py-1 text-sm text-foreground" value={st?.every_s ?? ''}
                  disabled={!st || setInterval_.isPending} onChange={(e) => setInterval_.mutate(Number(e.target.value))}>
            {st && !INTERVALS.some(([v]) => v === st.every_s) && <option value={st.every_s}>כל {Math.round(st.every_s / 60)} דק׳</option>}
            {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={runNow.isPending} onClick={() => runNow.mutate()}>
            {runNow.isPending ? 'בודק…' : 'בדוק עכשיו'}
          </Button>
          {st ? <span>אחרונה לפני {ago(st.last_ok ?? st.last_run)} · הבאה בעוד {inMin(st.next_run)} · כרטיסים {st.send ? 'פעילים' : 'מושהים'}
            {st.last_error ? <span className="text-destructive"> · שגיאה: {st.last_error}</span> : null}</span> : null}
          {(setInterval_.error || runNow.error) && <span className="text-destructive">{((setInterval_.error || runNow.error) as Error).message}</span>}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <form className="relative min-w-56 flex-1" onSubmit={(e) => { e.preventDefault(); setParams({ q: typed.trim() }) }}>
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="ps-9" value={typed} onChange={(e) => setTyped(e.target.value)}
                   onBlur={() => typed.trim() !== q && setParams({ q: typed.trim() })}
                   placeholder="חיפוש: חלק, רכב, VIN, רישוי, מק״ט, עיר (Enter)" />
          </form>
          <select className={select} value={outcome} onChange={(e) => setParams({ outcome: e.target.value })}>
            <option value="">כל הסטטוסים</option>
            {(['offer', 'not_stocked', 'not_found', 'error'] as const).map((k) => <option key={k} value={k}>{OUTCOME[k].he}</option>)}
          </select>
          <select className={select} value={make} onChange={(e) => setParams({ make: e.target.value })}>
            <option value="">כל היצרנים</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className={select} value={ctype} onChange={(e) => setParams({ ctype: e.target.value })}>
            <option value="">כל סוגי הלקוחות</option>
            {ctypes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={select} value={cond} onChange={(e) => setParams({ cond: e.target.value })}>
            <option value="">כל המצבים (משומש / חדש)</option>
            {conds.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={select} value={days} onChange={(e) => setParams({ days: e.target.value })}>
            {[7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} ימים אחרונים</option>)}
          </select>
          {anyFilter && (
            <Button size="sm" variant="ghost" onClick={() => { setTyped(''); setParams({ q: '', outcome: '', make: '', ctype: '', cond: '' }) }}>נקה סינון</Button>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{filtered.length} בקשות{isFetching ? ' · טוען…' : ''}</span>
        <div className="flex items-center gap-2">
          <select className={select} value={size} onChange={(e) => setParams({ size: e.target.value })}>
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} בעמוד</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setParams({ page: String(page) }, true)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="tabular-nums text-muted-foreground">עמוד {Math.min(page + 1, pages)} מתוך {pages}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setParams({ page: String(page + 2) }, true)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {isLoading ? <Skeleton className="h-64" /> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{sortHead('time', 'מועד')}</th>
                  <th className="p-2 text-start">{sortHead('customer', 'לקוח')}</th>
                  <th className="p-2 text-start">{sortHead('car', 'רכב')}</th>
                  <th className="p-2 text-start">{sortHead('part', 'חלק מבוקש')}</th>
                  <th className="p-2 text-start">דייגו v2</th>
                  <th className="p-2 text-start">{sortHead('offer', 'הצעה מוצעת')}</th>
                  <th className="p-2 text-start">{sortHead('status', 'סטטוס')}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const s = r.suggestion
                  const top = r.diego_rows?.[0]
                  return (
                    <tr key={r.id} className="border-t align-top">
                      <td className="whitespace-nowrap p-2 text-xs text-muted-foreground" dir="ltr">{r.date}</td>
                      <td className="p-2 text-xs">{r.ctype}<div className="text-muted-foreground">{r.location}</div></td>
                      <td className="p-2 text-xs">{r.make} {r.model} {r.year}
                        <div className="text-muted-foreground" dir="ltr">{r.vin || r.plate}</div></td>
                      <td className="p-2">{r.part}<div className="text-xs text-muted-foreground">{r.condition.join(' / ')}</div></td>
                      <td className="max-w-xs p-2 text-xs">
                        {top ? <>{top['תיאור']} · <span dir="ltr">{top['מק״ט']}</span>
                          <div className="text-muted-foreground">{r.diego_rows?.length ?? 0} שורות · {r.diego_s ?? '?'} ש׳</div></>
                          : <span className="text-muted-foreground">{r.error || r.diego_reply?.slice(0, 80) || '—'}</span>}
                      </td>
                      <td className="p-2 text-xs">
                        {s ? <><span dir="ltr">{s['מק״ט']}</span> · {s['מחיר']}<div className="text-muted-foreground">{SOURCE[s['במלאי'] ?? ''] ?? s['במלאי']}</div></> : '—'}
                      </td>
                      <td className="p-2">
                        <Badge variant="secondary" className={OUTCOME[r.outcome]?.cls}>{OUTCOME[r.outcome]?.he ?? r.outcome}</Badge>
                        {r.card_message_id ? <div className="mt-1 text-xs text-muted-foreground">כרטיס נשלח</div> : null}
                      </td>
                      <td className="p-2"><a href={floorLink(r)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="פתח בגלגלים"><ExternalLink className="h-4 w-4" /></a></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {data && !shown.length && <p className="p-6 text-center text-sm text-muted-foreground">אין בקשות שמתאימות</p>}
        </CardContent>
      </Card>
    </div>
  )
}
