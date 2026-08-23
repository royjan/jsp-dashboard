'use client'

import { useState, useMemo } from 'react'
import { useReceivables } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ReceivablesPageSkeleton } from '@/components/layout/PageSkeleton'
import { ErrorState } from '@/components/ui/feedback-state'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatTile, StatGrid } from '@/components/shared/StatTile'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import Link from 'next/link'
import {
  Receipt, AlertTriangle, Clock, DollarSign, Search,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS, BAR_MAX, PIE_PROPS } from '@/components/charts/kit'
import { formatCurrency, formatCurrencyAxis, formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'

const AGING_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#dc2626']

/**
 * An aging bucket: coloured when there is money in it, a dash when there isn't.
 * Zero renders as '—' rather than '₪0' so the eye only lands on real debt.
 */
function AgingCell({ value, className }: { value: number; className: string }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  if (!(value > 0)) return <span className="text-muted-foreground">—</span>
  return <span className={className}>{formatCurrency(value)}</span>
}

/** The translator, with its full key union preserved. */
type Translate = ReturnType<typeof useLocale>['t']

/* eslint-disable @typescript-eslint/no-explicit-any */
const RECEIVABLES_COLUMNS = (t: Translate): DataTableColumn<any>[] => [
  {
    key: 'name',
    header: t('customer'),
    sortable: true,
    truncate: 'max-w-[220px]',
    title: (c: any) => c.name,
    // Straight into the open-debts tab: from an AR row, the invoices behind the
    // balance are what the reader is after, not the purchase history.
    cell: (c: any) => (
      <Link href={`/customers/${c.code}/unpaid`} className="font-medium text-primary hover:underline">
        {c.name}
      </Link>
    ),
  },
  {
    key: 'agent',
    header: t('agent'),
    sortable: true,
    hideOnMobile: true,
    cellClassName: 'text-muted-foreground',
    cell: (c: any) => c.agent || '—',
  },
  {
    key: 'balance',
    header: t('balance'),
    align: 'end',
    sortable: true,
    cellClassName: 'font-medium',
    cell: (c: any) => formatCurrency(c.balance),
  },
  {
    key: 'current',
    header: t('currentDebt'),
    align: 'end',
    sortable: true,
    hideOnMobile: true,
    // Nested field — the table can't guess `c.aging.current` from the key.
    sortValue: (c: any) => c.aging?.current ?? 0,
    cell: (c: any) => (c.aging.current ? formatCurrency(c.aging.current) : '—'),
  },
  {
    key: 'days_30',
    header: t('overdue30'),
    align: 'end',
    sortable: true,
    sortValue: (c: any) => c.aging?.days_30 ?? 0,
    cell: (c: any) => <AgingCell value={c.aging.days_30} className="font-medium text-yellow-600 dark:text-yellow-500" />,
  },
  {
    key: 'days_60',
    header: t('overdue60'),
    align: 'end',
    sortable: true,
    sortValue: (c: any) => c.aging?.days_60 ?? 0,
    cell: (c: any) => <AgingCell value={c.aging.days_60} className="font-medium text-orange-600 dark:text-orange-500" />,
  },
  {
    key: 'days_90',
    header: t('overdue90'),
    align: 'end',
    sortable: true,
    sortValue: (c: any) => c.aging?.days_90 ?? 0,
    cell: (c: any) => <AgingCell value={c.aging.days_90} className="font-medium text-red-500" />,
  },
  {
    key: 'over_90',
    header: t('overdue90Plus'),
    align: 'end',
    sortable: true,
    sortValue: (c: any) => c.aging?.over_90 ?? 0,
    cell: (c: any) =>
      c.aging.over_90 > 0 ? (
        <Badge variant="destructive">{formatCurrency(c.aging.over_90)}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]
/* eslint-enable @typescript-eslint/no-explicit-any */

function LoadingSkeleton() {
  return <ReceivablesPageSkeleton />
}

export default function ReceivablesPage() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const { data, isLoading, error, refetch } = useReceivables(20)
  const [search, setSearch] = useState('')

  // Stable identity: DataTable re-sorts when `columns` changes, so rebuilding
  // the array every render would re-sort every render.
  const columns = useMemo(() => RECEIVABLES_COLUMNS(t), [t])

  // Sorting now lives in <DataTable> (uncontrolled) using the shared comparator,
  // so this only has to filter.
  const customers = useMemo(() => {
    if (!data?.customers) return []
    return data.customers.filter((c: any) =>
      !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.code?.includes(search)
    )
  }, [data, search])

  const totals = data?.totals

  const agingPieData = totals ? [
    { name: t('currentDebt'), value: totals.total_current },
    { name: t('overdue30'), value: totals.total_30 },
    { name: t('overdue60'), value: totals.total_60 },
    { name: t('overdue90'), value: totals.total_90 },
    { name: t('overdue90Plus'), value: totals.total_over_90 },
  ].filter(d => d.value > 0) : []

  const overdueCount = customers.filter((c: any) =>
    c.aging.days_30 > 0 || c.aging.days_60 > 0 || c.aging.days_90 > 0 || c.aging.over_90 > 0
  ).length

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />

  return (
    <div className="space-y-6">
      <PageHeader title={t('page.receivables')} icon={Receipt} />

      {/* KPI tiles. `higherIsBetter: false` on the overdue metrics — a rise in
          debt is red even though the arrow points the same way as revenue. */}
      <StatGrid columns={5}>
        {[
          { label: t('totalBalance'), value: formatCurrency(totals?.total_balance ?? 0), icon: DollarSign, tone: 'info' as const },
          { label: t('currentDebt'), value: formatCurrency(totals?.total_current ?? 0), icon: Receipt, tone: 'good' as const },
          { label: t('overdue30') + '+', value: formatCurrency((totals?.total_30 ?? 0) + (totals?.total_60 ?? 0) + (totals?.total_90 ?? 0) + (totals?.total_over_90 ?? 0)), icon: Clock, tone: 'warn' as const },
          { label: t('overdue90Plus'), value: formatCurrency(totals?.total_over_90 ?? 0), icon: AlertTriangle, tone: 'bad' as const },
          { label: t('overdueCustomers'), value: formatNumber(overdueCount), icon: AlertTriangle, tone: 'warn' as const },
        ].map((kpi, i) => (
          <StatTile
            key={kpi.label}
            index={i}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            tone={kpi.tone}
            higherIsBetter={false}
          />
        ))}
      </StatGrid>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Aging Pie */}
        <Card>
          <CardHeader><CardTitle className="text-base">{t('agingBreakdown')}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={agingPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={46} outerRadius={88} label={({ percent }) => ((percent ?? 0) >= 0.06 ? `${((percent ?? 0) * 100).toFixed(0)}%` : '')} labelLine={false} {...PIE_PROPS}>
                  {agingPieData.map((_, i) => <Cell key={i} fill={AGING_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v as number)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2" dir="auto">
              {agingPieData.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: AGING_COLORS[i] }} />
                  <span className="text-muted-foreground">{entry.name}</span>
                  <span className="font-semibold">{formatCurrency(entry.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Overdue Bar Chart */}
        <Card>
          <CardHeader><CardTitle className="text-base">{t('overdueCustomers')}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={customers.filter((c: any) => c.aging.over_90 > 0).slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                <ChartGrid vertical horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => formatCurrencyAxis(v)} {...AXIS_PROPS} />
                <YAxis type="category" dataKey="name" width={140} {...AXIS_PROPS} tickFormatter={(v: string) => v.length > 20 ? v.substring(0, 20) + '…' : v} />
                <Tooltip formatter={(v) => formatCurrency(v as number)} />
                <Bar dataKey="aging.over_90" fill="#ef4444" name={t('overdue90Plus')} radius={BAR_RADIUS.horizontal} maxBarSize={BAR_MAX}>
                  {customers.filter((c: any) => c.aging.over_90 > 0).slice(0, 10).map((c: any, i: number) => (
                    <Cell key={c.code || i} fill={c.aging.over_90 > 1000 ? '#dc2626' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Customer Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base">{t('customers')} ({customers.length})</CardTitle>
            <div className="relative">
              <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="ps-8 h-9 rounded-md border bg-background px-3 text-sm w-full sm:w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={customers}
            columns={columns}
            getRowKey={(c: any) => c.code}
            defaultSort={{ field: 'balance', dir: 'desc' }}
            maxHeight="70vh"
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    </div>
  )
}
