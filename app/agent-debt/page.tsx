'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Loader2, MapPin, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { isMoneyHidden, MONEY_MASK } from '@/lib/privacy'

const AREAS = ['השרון', 'צפון', 'דרום', 'ירושלים', 'מרכז', 'אילת והסביבה', 'רשות פלסטינאית', 'לא משויך']
const SELECT_CLS =
  'h-9 pointer-coarse:h-11 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

interface Column { key: string; label: string }
interface DebtRow {
  code: string; name: string; city: string; phone?: string; address?: string
  buckets: Record<string, number>; total: number
}
interface AreaBlock {
  area: string; total: number; debtor_count: number
  cities: { city: string; rows: DebtRow[]; subtotal: { total: number } }[]
}
interface Report {
  generated: string; months: number; columns: Column[]; areas: AreaBlock[]
  summary: { area: string; debtor_count: number; total: number; buckets: Record<string, number> }[]
  grand_total: number; excluded?: { count: number; total: number }
  error?: string
}
interface FlatRow extends DebtRow { area: string }

/** A month amount. Money, so the demo-mode eye masks it like formatCurrency() does — the row
 *  total alone being masked was no privacy at all, the months add up to it. */
function monthAmount(v: number | undefined): string {
  if (!v) return '—'
  return isMoneyHidden() ? MONEY_MASK : formatNumber(Math.round(v))
}

async function fetchReport(params: URLSearchParams): Promise<Report> {
  const r = await fetch(`/api/agent-debt?${params}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j as Report
}

/**
 * דוח חובות לסוכן — open customer debt by area and invoice month. Read-only view of FINAPI's
 * agent-debt report, served from the AR box (.109): the receivables files on .111 are broken.
 * City → area rules and customer pins are edited on FINAPI's own /customers/areas page.
 */
export default function AgentDebtPage() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module store, so without
  // this the area cards kept their dots after the eye was switched off.
  useMoneyHidden()
  const [area, setArea] = useState('')
  const [months, setMonths] = useState(3)
  const [refreshTick, setRefreshTick] = useState(0)

  const params = useMemo(() => {
    const p = new URLSearchParams({ months: String(months) })
    if (area) p.set('area', area)
    if (refreshTick) p.set('refresh', '1')
    return p
  }, [area, months, refreshTick])

  const q = useQuery<Report>({
    queryKey: ['agent-debt', area, months, refreshTick],
    queryFn: () => fetchReport(params),
    staleTime: 5 * 60_000,
  })
  const rep = q.data

  const rows: FlatRow[] = useMemo(
    () => (rep?.areas ?? []).flatMap((a) => a.cities.flatMap((c) => c.rows.map((r) => ({ ...r, area: a.area })))),
    [rep],
  )

  const columns: DataTableColumn<FlatRow>[] = useMemo(() => {
    const months = (rep?.columns ?? []).map<DataTableColumn<FlatRow>>((c) => ({
      key: `m_${c.key}`, header: c.label, align: 'end', sortable: true,
      cell: (r) => (r.buckets?.[c.key] ? monthAmount(r.buckets[c.key]) : <span className="text-muted-foreground">—</span>),
      sortValue: (r) => r.buckets?.[c.key] ?? 0,
      exportValue: (r) => r.buckets?.[c.key] ?? 0,
    }))
    return [
      ...(area ? [] : [{ key: 'area', header: 'אזור', cell: (r: FlatRow) => r.area, sortable: true } as DataTableColumn<FlatRow>]),
      { key: 'city', header: 'עיר', cell: (r) => r.city, sortable: true },
      {
        key: 'code', header: 'לקוח', sortable: true, sortValue: (r) => r.name,
        cell: (r) => (
          <div className="min-w-0">
            <Link href={`/customers/${r.code}`} className="font-medium hover:underline">{r.name}</Link>
            <div className="font-mono text-[11px] text-muted-foreground"><span dir="ltr">{r.code}</span></div>
          </div>
        ),
        exportValue: (r) => `${r.code} ${r.name}`,
      },
      { key: 'phone', header: 'טלפון', cell: (r) => <span dir="ltr" className="tabular-nums">{r.phone || '—'}</span>, hideOnMobile: true },
      ...months,
      {
        key: 'total', header: 'סה״כ', align: 'end', sortable: true,
        cell: (r) => <span className="font-semibold">{formatCurrency(r.total)}</span>,
        sortValue: (r) => r.total, exportValue: (r) => r.total,
      },
    ]
  }, [rep, area])

  return (
    <div className="space-y-4">
      <PageHeader
        title="חובות לפי אזור"
        icon={MapPin}
        description="חוב פתוח של כל לקוח לפי חודש חשבונית, מקובץ לפי אזור — דוח חובות לסוכן"
        actions={
          <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => setRefreshTick((t) => t + 1)}>
            {q.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} רענון
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">אזור</span>
          <select className={SELECT_CLS} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">כל האזורים</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">חודשים בעמודות</span>
          <select className={SELECT_CLS} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[1, 2, 3, 4, 6, 9, 12].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {rep?.generated && (
          <span className="text-xs text-muted-foreground">נכון ל-<span dir="ltr">{rep.generated}</span></span>
        )}
      </div>

      {rep && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          <div className="rounded-xl border bg-card p-3">
            <div className="text-xs text-muted-foreground">סה״כ חוב פתוח</div>
            <div className="text-xl font-bold tabular-nums">{formatCurrency(rep.grand_total)}</div>
            <div className="text-xs text-muted-foreground">{formatNumber(rep.summary.reduce((s, a) => s + a.debtor_count, 0))} לקוחות</div>
          </div>
          {rep.summary.map((s) => (
            <button
              key={s.area}
              type="button"
              onClick={() => setArea(area === s.area ? '' : s.area)}
              className={cn('rounded-xl border bg-card p-3 text-start transition-colors hover:border-primary/50',
                area === s.area && 'border-primary')}
            >
              <div className="text-xs text-muted-foreground">{s.area}</div>
              <div className="text-lg font-semibold tabular-nums">{formatCurrency(s.total)}</div>
              <div className="text-xs text-muted-foreground">{formatNumber(s.debtor_count)} לקוחות</div>
            </button>
          ))}
        </div>
      )}

      {rep?.excluded && rep.excluded.count > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatNumber(rep.excluded.count)} לקוחות הוצאו מהדוח (סומנו &quot;לא בדוח&quot;, למשל שוכרים) — {formatCurrency(rep.excluded.total)}.
        </p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => `${r.area}:${r.code}`}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        defaultSort={{ field: 'total', dir: 'desc' }}
        minWidth="min-w-[900px]"
        maxHeight="calc(100dvh - 14rem)"
        pageSize={100}
        exportFileName={`agent-debt${area ? `-${area}` : ''}`}
        mobileCard={{
          title: (r) => r.name,
          subtitle: (r) => <span>{r.area} · {r.city}</span>,
          accent: (r) => formatCurrency(r.total),
          fields: (rep?.columns ?? []).map((c) => ({ label: c.label, value: (r: FlatRow) => monthAmount(r.buckets?.[c.key]) })),
        }}
        labels={{ empty: 'אין חובות פתוחים באזור הזה' }}
      />
    </div>
  )
}
