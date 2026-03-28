'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCustomerAnalytics } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  ArrowUpDown, Search,
  Users, UserMinus, DollarSign, AlertTriangle, TrendingUp, TrendingDown, Minus, Crown, ShieldAlert,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { ILS_FORMAT, NUMBER_FORMAT } from '@/lib/constants'

type CustomerSortField = 'name' | 'total_revenue' | 'gross_invoices' | 'total_credits' | 'invoice_count' | 'avg_order_value' | 'trend' | 'last_purchase'
type ChurnSortField = 'name' | 'last_year_revenue' | 'last_purchase'
type SortDir = 'asc' | 'desc'
type ViewTab = 'top' | 'churned'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tableRowVariants: any = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({
    opacity: 1, x: 0,
    transition: { delay: i * 0.025, duration: 0.3 },
  }),
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <Badge variant="success" className="gap-1"><TrendingUp className="h-3 w-3" /><span className="hidden md:inline">↑</span></Badge>
  if (trend === 'down') return <Badge variant="destructive" className="gap-1"><TrendingDown className="h-3 w-3" /><span className="hidden md:inline">↓</span></Badge>
  return <Badge variant="secondary" className="gap-1"><Minus className="h-3 w-3" /><span className="hidden md:inline">→</span></Badge>
}

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

  const { data, isLoading } = useCustomerAnalytics(dateFrom, dateTo)

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

  const CustSortHeader = ({ field, children, className }: { field: CustomerSortField; children: React.ReactNode; className?: string }) => (
    <th className={cn('pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap', className)}
      onClick={() => { if (custSort === field) setCustDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCustSort(field); setCustDir('desc') } }}>
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className={cn('h-3 w-3 shrink-0', custSort === field ? 'text-foreground' : 'text-muted-foreground/50')} />
      </span>
    </th>
  )

  const ChurnSortHeader = ({ field, children, className }: { field: ChurnSortField; children: React.ReactNode; className?: string }) => (
    <th className={cn('pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap', className)}
      onClick={() => { if (churnSort === field) setChurnDir(d => d === 'asc' ? 'desc' : 'asc'); else { setChurnSort(field); setChurnDir('desc') } }}>
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className={cn('h-3 w-3 shrink-0', churnSort === field ? 'text-foreground' : 'text-muted-foreground/50')} />
      </span>
    </th>
  )

  if (isLoading) return <LoadingSkeleton />
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
      <div className="flex justify-end">
        <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to) }} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        {[
          { icon: Users, label: t('activeCustomers'), value: data.summary.active_this_year, sub: `${data.summary.total_customers} ${t('total').toLowerCase()}`, color: 'text-primary' },
          { icon: UserMinus, label: t('churnedCustomers'), value: data.summary.churned_count, color: data.summary.churned_count > 0 ? 'text-destructive' : 'text-muted-foreground' },
          { icon: DollarSign, label: t('avgOrderValue'), value: data.summary.avg_order_value, format: 'currency' as const, color: 'text-primary' },
          { icon: ShieldAlert, label: t('concentrationRisk'), value: data.concentration.top5_pct, format: 'percent' as const, sub: `${t('top10')}: ${data.concentration.top10_pct}%`, color: concentrationLevel === 'destructive' ? 'text-destructive' : concentrationLevel === 'warning' ? 'text-amber-500' : 'text-emerald-500' },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} custom={i} variants={cardVariants} initial="hidden" animate="visible">
            <Card className="overflow-hidden h-full">
              <CardContent className="p-3 md:p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
                  <kpi.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{kpi.label}</span>
                </div>
                <div className={cn('text-xl md:text-2xl font-bold', kpi.color)}>
                  <AnimatedCounter value={kpi.value} format={kpi.format || 'number'} />
                </div>
                {kpi.sub && <div className="text-[11px] md:text-xs text-muted-foreground mt-1">{kpi.sub}</div>}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

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
                        <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px]">{data.summary.churned_count}</Badge>
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
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto -mx-4 md:mx-0">
                      <table className="w-full text-sm min-w-[700px]">
                        <thead className="sticky top-0 bg-background z-10">
                          <tr className="border-b">
                            <CustSortHeader field="name" className="text-start ps-4 md:ps-0">{t('customer')}</CustSortHeader>
                            <CustSortHeader field="gross_invoices" className="text-end">{t('invoices')}</CustSortHeader>
                            <CustSortHeader field="total_credits" className="text-end">{t('credits')}</CustSortHeader>
                            <CustSortHeader field="total_revenue" className="text-end">{t('netRevenue')}</CustSortHeader>
                            <CustSortHeader field="invoice_count" className="text-end">{t('orders')}</CustSortHeader>
                            <CustSortHeader field="trend" className="text-center">{t('trend')}</CustSortHeader>
                            <CustSortHeader field="last_purchase" className="text-end pe-4 md:pe-0">{t('lastPurchase')}</CustSortHeader>
                          </tr>
                        </thead>
                        <tbody>
                          {customers.slice(0, 100).map((cust: any, idx: number) => (
                            <motion.tr key={cust.code || idx} custom={idx} variants={tableRowVariants} initial="hidden" animate="visible" className="border-b hover:bg-muted/50 transition-colors">
                              <td className="py-2.5 ps-4 md:ps-0">
                                <div className="flex items-center gap-2">
                                  {idx < 3 && <Crown className={cn('h-3.5 w-3.5 shrink-0', idx === 0 ? 'text-amber-500' : idx === 1 ? 'text-slate-400' : 'text-amber-700')} />}
                                  <div>
                                    <div className="font-medium truncate max-w-[180px] md:max-w-none">{cust.name}</div>
                                    <div className="text-xs text-muted-foreground">{cust.code}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 text-end font-mono tabular-nums">{ILS_FORMAT.format(cust.gross_invoices)}</td>
                              <td className="py-2.5 text-end font-mono tabular-nums text-destructive">{cust.total_credits > 0 ? `-${ILS_FORMAT.format(cust.total_credits)}` : '—'}</td>
                              <td className="py-2.5 text-end font-mono tabular-nums font-semibold">{ILS_FORMAT.format(cust.total_revenue)}</td>
                              <td className="py-2.5 text-end tabular-nums">{cust.invoice_count}</td>
                              <td className="py-2.5 text-center"><TrendIcon trend={cust.trend} /></td>
                              <td className="py-2.5 text-end text-muted-foreground pe-4 md:pe-0">{cust.last_purchase?.substring(0, 10)}</td>
                            </motion.tr>
                          ))}
                          {customers.length === 0 && <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">{t('noInsights')}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="churned" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                    {churned.length === 0 ? (
                      <div className="py-12 text-center text-muted-foreground">
                        <UserMinus className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p>{t('noInsights')}</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto max-h-[500px] overflow-y-auto -mx-4 md:mx-0">
                        <table className="w-full text-sm min-w-[500px]">
                          <thead className="sticky top-0 bg-background z-10">
                            <tr className="border-b">
                              <ChurnSortHeader field="name" className="text-start ps-4 md:ps-0">{t('customer')}</ChurnSortHeader>
                              <ChurnSortHeader field="last_year_revenue" className="text-end">{t('lastYearRevenue')}</ChurnSortHeader>
                              <ChurnSortHeader field="last_purchase" className="text-end pe-4 md:pe-0">{t('lastPurchase')}</ChurnSortHeader>
                            </tr>
                          </thead>
                          <tbody>
                            {churned.map((cust: any, idx: number) => (
                              <motion.tr key={cust.code || idx} custom={idx} variants={tableRowVariants} initial="hidden" animate="visible" className="border-b hover:bg-muted/50 transition-colors">
                                <td className="py-2.5 ps-4 md:ps-0">
                                  <div className="font-medium truncate max-w-[200px] md:max-w-none">{cust.name}</div>
                                  <div className="text-xs text-muted-foreground">{cust.code}</div>
                                </td>
                                <td className="py-2.5 text-end font-mono text-destructive tabular-nums">{ILS_FORMAT.format(cust.last_year_revenue)}</td>
                                <td className="py-2.5 text-end text-muted-foreground pe-4 md:pe-0">{cust.last_purchase?.substring(0, 10)}</td>
                              </motion.tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
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
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }} formatter={(value: any, name: any, props: any) => [ILS_FORMAT.format(value as number), props.payload.fullName || name]} />
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
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }} formatter={(value: any) => [ILS_FORMAT.format(value), t('revenue')]} />
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
    <Suspense fallback={<LoadingSkeleton />}>
      <CustomersPageContent />
    </Suspense>
  )
}
