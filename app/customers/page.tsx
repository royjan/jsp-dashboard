'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCustomerAnalytics } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { DateRangePresets } from '@/components/shared/DateRangePresets'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CustomersPageSkeleton } from '@/components/layout/PageSkeleton'
import { ErrorState } from '@/components/ui/feedback-state'
import { SubTabs } from '@/components/shared/SubTabs'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  Search,
  Users, UserMinus, DollarSign, TrendingUp, TrendingDown, Minus, Crown, ShieldAlert,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { formatCurrency, formatNumber, formatDate, formatCurrencyAxis } from '@/lib/format'
import { StatTile, StatGrid } from '@/components/shared/StatTile'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { useMoneyHidden } from '@/lib/use-money-hidden'

type CustomerSortField = 'name' | 'total_revenue' | 'gross_invoices' | 'total_credits' | 'invoice_count' | 'avg_order_value' | 'trend' | 'last_purchase'
type ChurnSortField = 'name' | 'last_year_revenue' | 'last_purchase'
type SortDir = 'asc' | 'desc'
type ViewTab = 'top' | 'churned'

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <Badge variant="success" className="gap-1"><TrendingUp className="h-3 w-3" /><span className="hidden md:inline">↑</span></Badge>
  if (trend === 'down') return <Badge variant="destructive" className="gap-1"><TrendingDown className="h-3 w-3" /><span className="hidden md:inline">↓</span></Badge>
  return <Badge variant="secondary" className="gap-1"><Minus className="h-3 w-3" /><span className="hidden md:inline">→</span></Badge>
}

/** The translator, with its full key union preserved. */
type Translate = ReturnType<typeof useLocale>['t']

/** Customer name + code, the identity cell shared by both tables. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomerCell({ cust, rank }: { cust: any; rank?: number }) {
  return (
    <div className="flex items-center gap-2">
      {rank !== undefined && rank < 3 && (
        <Crown className={cn('h-3.5 w-3.5 shrink-0', rank === 0 ? 'text-amber-500' : rank === 1 ? 'text-slate-400' : 'text-amber-700')} />
      )}
      <div className="min-w-0">
        <Link href={`/customers/${cust.code}`} className="block truncate font-medium text-primary hover:underline">
          {cust.name}
        </Link>
        <div className="text-xs text-muted-foreground">{cust.code}</div>
      </div>
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const CUSTOMER_COLUMNS = (t: Translate): DataTableColumn<any, CustomerSortField>[] => [
  { key: 'name', header: t('customer'), sortable: true, cell: (cust: any, idx: number) => <CustomerCell cust={cust} rank={idx} /> },
  { key: 'gross_invoices', header: t('invoices'), align: 'end', sortable: true, cellClassName: 'font-mono', cell: (c: any) => formatCurrency(c.gross_invoices) },
  { key: 'total_credits', header: t('credits'), align: 'end', sortable: true, hideOnMobile: true, cellClassName: 'font-mono text-destructive', cell: (c: any) => (c.total_credits > 0 ? `-${formatCurrency(c.total_credits)}` : '—') },
  { key: 'total_revenue', header: t('netRevenue'), align: 'end', sortable: true, cellClassName: 'font-mono font-semibold', cell: (c: any) => formatCurrency(c.total_revenue) },
  { key: 'invoice_count', header: t('orders'), align: 'end', sortable: true, cell: (c: any) => formatNumber(c.invoice_count) },
  { key: 'trend', header: t('trend'), align: 'center', sortable: true, cell: (c: any) => <TrendIcon trend={c.trend} /> },
  { key: 'last_purchase', header: t('lastPurchase'), align: 'end', sortable: true, cellClassName: 'text-muted-foreground', cell: (c: any) => formatDate(c.last_purchase) },
]

const CHURN_COLUMNS = (t: Translate): DataTableColumn<any, ChurnSortField>[] => [
  { key: 'name', header: t('customer'), sortable: true, cell: (cust: any) => <CustomerCell cust={cust} /> },
  { key: 'last_year_revenue', header: t('lastYearRevenue'), align: 'end', sortable: true, cellClassName: 'font-mono text-destructive', cell: (c: any) => formatCurrency(c.last_year_revenue) },
  { key: 'last_purchase', header: t('lastPurchase'), align: 'end', sortable: true, cellClassName: 'text-muted-foreground', cell: (c: any) => formatDate(c.last_purchase) },
]
/* eslint-enable @typescript-eslint/no-explicit-any */

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-20 mb-3" />
              <Skeleton className="h-8 w-24 mb-2" />
              <Skeleton className="h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
            <CardContent>
              <div className="space-y-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent><Skeleton className="w-full h-[300px] rounded-lg" /></CardContent>
        </Card>
      </div>
    </div>
  )
}

// ── Customers section ──

function CustomersSection({ searchQuery }: { searchQuery: string }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const { get, setMany } = useUrlParams()
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]

  const [dateFrom, setDateFrom] = useState(get('cust_from') || `${currentYear}-01-01`)
  const [dateTo, setDateTo] = useState(get('cust_to') || today)
  const [viewTab, setViewTab] = useState<ViewTab>((get('view') as ViewTab) || 'top')
  const [custSort, setCustSort] = useState<CustomerSortField>((get('csort') as CustomerSortField) || 'total_revenue')
  const [custDir, setCustDir] = useState<SortDir>((get('cdir') as SortDir) || 'desc')
  const [churnSort, setChurnSort] = useState<ChurnSortField>((get('hsort') as ChurnSortField) || 'last_year_revenue')
  const [churnDir, setChurnDir] = useState<SortDir>((get('hdir') as SortDir) || 'desc')

  const { data, isLoading, error, refetch } = useCustomerAnalytics(dateFrom, dateTo)

  useEffect(() => {
    setMany({
      cust_from: dateFrom === `${currentYear}-01-01` ? null : dateFrom,
      cust_to: dateTo === today ? null : dateTo,
      view: viewTab === 'top' ? null : viewTab,
      csort: custSort === 'total_revenue' ? null : custSort,
      cdir: custDir === 'desc' ? null : custDir,
      hsort: churnSort === 'last_year_revenue' ? null : churnSort,
      hdir: churnDir === 'desc' ? null : churnDir,
    })
  }, [dateFrom, dateTo, viewTab, custSort, custDir, churnSort, churnDir, setMany])

  const customers = useMemo(() => {
    let custs = data?.customers || []
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      custs = custs.filter((c: any) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    }
    return [...custs].sort((a: any, b: any) => {
      const cmp = (custSort === 'name' || custSort === 'trend' || custSort === 'last_purchase')
        ? (a[custSort] || '').localeCompare(b[custSort] || '')
        : (a[custSort] as number) - (b[custSort] as number)
      return custDir === 'desc' ? -cmp : cmp
    })
  }, [data, searchQuery, custSort, custDir])

  // Sort stays CONTROLLED here — it is persisted to the URL above, so the page
  // owns it and <DataTable> just reports clicks.
  const customerColumns = useMemo(() => CUSTOMER_COLUMNS(t), [t])
  const churnColumns = useMemo(() => CHURN_COLUMNS(t), [t])

  const churned = useMemo(() => {
    let ch = data?.churned || []
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      ch = ch.filter((c: any) => c.name.toLowerCase().includes(q))
    }
    return [...ch].sort((a: any, b: any) => {
      const cmp = (churnSort === 'name' || churnSort === 'last_purchase')
        ? (a[churnSort] || '').localeCompare(b[churnSort] || '')
        : (a[churnSort] as number) - (b[churnSort] as number)
      return churnDir === 'desc' ? -cmp : cmp
    })
  }, [data, searchQuery, churnSort, churnDir])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />
  if (!data) return null

  const pieData = (() => {
    const top5Rev = data.customers.slice(0, 5).reduce((s: number, c: any) => s + c.total_revenue, 0)
    const rest = data.summary.total_revenue - top5Rev
    const colors = ['#34d399', '#60a5fa', '#f59e0b', '#a78bfa', '#f87171']
    const items = data.customers.slice(0, 5).map((c: any, i: number) => ({
      name: c.name.length > 15 ? c.name.substring(0, 15) + '…' : c.name,
      fullName: c.name, value: c.total_revenue, fill: colors[i],
    }))
    if (rest > 0) items.push({ name: t('others'), fullName: t('others'), value: rest, fill: '#6b7280' })
    return items
  })()

  const top10Data = data.customers.slice(0, 10).map((c: any) => ({
    name: c.name.length > 12 ? c.name.substring(0, 12) + '…' : c.name,
    revenue: c.total_revenue,
  }))

  const concentrationLevel = data.concentration.top5_pct >= 60 ? 'destructive' : data.concentration.top5_pct >= 40 ? 'warning' : 'success'

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-wrap justify-end items-center gap-2">
        <DateRangePresets dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to) }} />
        <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to) }} />
      </div>

      {/* The value stays an <AnimatedCounter> — StatTile takes a node, so the
          count-up survives the move onto the shared tile. */}
      <StatGrid columns={4}>
        {[
          { icon: Users, label: t('activeCustomers'), value: data.summary.active_this_year, sub: `${data.summary.total_customers} ${t('total').toLowerCase()}`, tone: 'info' as const },
          { icon: UserMinus, label: t('churnedCustomers'), value: data.summary.churned_count, tone: data.summary.churned_count > 0 ? ('bad' as const) : ('default' as const) },
          { icon: DollarSign, label: t('avgOrderValue'), value: data.summary.avg_order_value, format: 'currency' as const, tone: 'info' as const },
          { icon: ShieldAlert, label: t('concentrationRisk'), value: data.concentration.top5_pct, format: 'percent' as const, sub: `${t('top10')}: ${data.concentration.top10_pct}%`, tone: concentrationLevel === 'destructive' ? ('bad' as const) : concentrationLevel === 'warning' ? ('warn' as const) : ('good' as const) },
        ].map((kpi, i) => (
          <StatTile
            key={kpi.label}
            index={i}
            icon={kpi.icon}
            label={kpi.label}
            tone={kpi.tone}
            hint={kpi.sub}
            value={<AnimatedCounter value={kpi.value} format={kpi.format || 'number'} />}
          />
        ))}
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-6">
        <motion.div className="xl:col-span-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }}>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <Tabs value={viewTab} onValueChange={(v) => setViewTab(v as ViewTab)}>
                  <TabsList>
                    <TabsTrigger value="top" className="gap-1.5">
                      <Crown className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t('topCustomers')}</span>
                      <span className="sm:hidden">{t('top5')}</span>
                    </TabsTrigger>
                    <TabsTrigger value="churned" className="gap-1.5">
                      <UserMinus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t('churnAlert')}</span>
                      <span className="sm:hidden">{t('churnedCustomers')}</span>
                      {data.summary.churned_count > 0 && (
                        <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px]">{formatNumber(data.summary.churned_count)}</Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <span className="text-xs text-muted-foreground">
                  {viewTab === 'top' ? customers.length : churned.length} {t('items')}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait">
                {viewTab === 'top' ? (
                  <motion.div key="top" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }}>
                    <DataTable
                      rows={customers}
                      columns={customerColumns}
                      getRowKey={(c: any, i: number) => c.code || i}
                      sort={{ field: custSort, dir: custDir }}
                      onSortChange={({ field, dir }) => { setCustSort(field); setCustDir(dir) }}
                      maxHeight="500px"
                      // Was `.slice(0, 100)` applied silently before render.
                      maxRows={100}
                      labels={{ empty: t('noInsights') }}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="churned" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                    <DataTable
                      rows={churned}
                      columns={churnColumns}
                      getRowKey={(c: any, i: number) => c.code || i}
                      sort={{ field: churnSort, dir: churnDir }}
                      onSortChange={({ field, dir }) => { setChurnSort(field); setChurnDir(dir) }}
                      minWidth="min-w-[500px]"
                      maxHeight="500px"
                      labels={{ empty: t('noInsights') }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div className="space-y-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('concentrationChart')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2} animationDuration={800} animationBegin={500}>
                    {pieData.map((entry: any, index: number) => <Cell key={index} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }} formatter={(value: any, name: any, props: any) => [formatCurrency(value as number), props.payload.fullName || name]} />
                  <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                  <text x="50%" y="46%" textAnchor="middle" fill="var(--foreground)" fontSize={18}>{data.concentration.top5_pct}%</text>
                  <text x="50%" y="57%" textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>{t('top5')}</text>
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('topCustomers')} {t('revenue')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={top10Data} layout="vertical" margin={{ left: 5, right: 15, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrencyAxis(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }} formatter={(value: any) => [formatCurrency(value), t('revenue')]} />
                  <Bar dataKey="revenue" fill="#60a5fa" radius={[0, 4, 4, 0]} animationDuration={800} animationBegin={600} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}

// ── Main page ──

function CustomersPageContent() {
  const { t } = useLocale()
  const { get, setMany } = useUrlParams()
  const [searchQuery, setSearchQuery] = useState(get('search') || '')

  useEffect(() => {
    setMany({ search: searchQuery || null })
  }, [searchQuery, setMany])

  return (
    <div className="space-y-4 md:space-y-6">
      <SubTabs
        tabs={[
          { href: '/customers', label: t('customers') },
          { href: '/customers/health-score', label: t('customerHealth') },
        ]}
      />
      <div className="flex justify-end">
        <div className="relative min-w-[180px] sm:max-w-xs">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent ps-8 pe-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
      <CustomersSection searchQuery={searchQuery} />
    </div>
  )
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<CustomersPageSkeleton />}>
      <CustomersPageContent />
    </Suspense>
  )
}
