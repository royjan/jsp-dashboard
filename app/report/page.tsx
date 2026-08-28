'use client'

import { Suspense, useState, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { useBusinessReport } from '@/hooks/use-analytics'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ActionPlaybook } from '@/components/report/ActionPlaybook'
import { AlertTriangle, ArrowRight, BarChart3, Calendar, FileBarChart, FileText, Package, RefreshCw, Target, TrendingDown, TrendingUp, Users } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, AreaChart, Area, Cell, PieChart, Pie,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS, BAR_MAX, ACTIVE_BAR, ACTIVE_DOT } from '@/components/charts/kit'
import { formatCurrency, formatNumber, formatCurrencyAxis, maskMoneyInText } from '@/lib/format'
import { cardVariants } from '@/lib/motion'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { isDeclineHidden } from '@/lib/privacy'
import { DataWarning } from '@/components/shared/DataWarning'
import { PageHeader } from '@/components/shared/PageHeader'

const MONTH_LABELS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Section = 'summary' | 'deadstock' | 'revenue' | 'seasonal' | 'credits' | 'customers' | 'recommendations'


function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(8)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-6"><Skeleton className="h-[300px] w-full" /></CardContent></Card>
    </div>
  )
}

function KPICard({ icon: Icon, label, value, sub, color, index }: {
  icon: typeof TrendingUp; label: string; value: string; sub?: string; color: string; index: number
}) {
  return (
    <motion.div custom={index} variants={cardVariants} initial="hidden" animate="visible">
      <Card className="overflow-hidden h-full">
        <CardContent className="p-3 md:p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </div>
          <div className={cn('text-lg md:text-2xl font-bold tabular-nums', color)}>{value}</div>
          {sub && <div className="text-[11px] md:text-xs text-muted-foreground mt-1">{sub}</div>}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function ReportContent() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t, locale } = useLocale()
  const isHe = locale === 'he'
  const monthLabels = isHe ? MONTH_LABELS_HE : MONTH_LABELS_EN
  const { data, isLoading, isFetching, dataUpdatedAt } = useBusinessReport()
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const SECTIONS: Section[] = ['summary', 'deadstock', 'revenue', 'seasonal', 'credits', 'customers', 'recommendations']
  const urlSection = searchParams.get('section') as Section | null
  const [section, setSection] = useState<Section>(
    urlSection && SECTIONS.includes(urlSection) ? urlSection : 'summary'
  )

  // The 'revenue' tab is literally titled "ירידה בהכנסות" — demo mode drops the
  // tab AND its body, and falls back to summary so a bookmarked
  // `?section=revenue` doesn't land on an empty page.
  const hideDecline = isDeclineHidden(true)
  const activeSection = hideDecline && section === 'revenue' ? 'summary' : section

  // Keep the active tab in the URL so each section is deep-linkable / bookmarkable.
  const changeSection = (v: Section) => {
    setSection(v)
    const params = new URLSearchParams(searchParams.toString())
    params.set('section', v)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['business-report'] })
  }

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(isHe ? 'he-IL' : 'en-IL', { hour: '2-digit', minute: '2-digit' })
    : null

  const revenueChartData = useMemo(() => {
    if (!data?.revenue_by_year) return []
    return data.revenue_by_year.map((r: any) => ({
      year: r.year,
      revenue: Math.round(r.revenue),
      invoices: r.invoice_count,
      credits: Math.round(r.credit_total),
    }))
  }, [data])

  // The three years this section compares. These used to be the string literals
  // '2023'/'2024'/'2025', so the chart, the table and both their titles quietly
  // went stale a year after they were written — in 2026 the page was still
  // showing 2023-2025 under a heading that said so, which reads as current.
  const compareYears = useMemo(() => {
    const years = (data?.monthly_revenue || []).map((r: any) => Number(r.year))
    const latest = years.length ? Math.max(...years) : new Date().getFullYear()
    return { cur: latest, prev: latest - 1, prev2: latest - 2 }
  }, [data])

  const monthlyCompare = useMemo(() => {
    if (!data?.monthly_revenue) return []
    const byYearMonth: Record<number, Record<number, number>> = {}
    for (const r of data.monthly_revenue) {
      const y = Number(r.year)
      if (!byYearMonth[y]) byYearMonth[y] = {}
      byYearMonth[y][r.month] = Math.round(r.revenue)
    }
    return Array.from({ length: 12 }, (_, i) => ({
      month: monthLabels[i],
      prev2: byYearMonth[compareYears.prev2]?.[i + 1] || 0,
      prev: byYearMonth[compareYears.prev]?.[i + 1] || 0,
      cur: byYearMonth[compareYears.cur]?.[i + 1] || 0,
    }))
  }, [data, monthLabels, compareYears])

  const seasonalData = useMemo(() => {
    if (!data?.seasonality) return []
    return data.seasonality.map((r: any) => ({
      month: monthLabels[r.month - 1],
      avg_revenue: Math.round(r.avg_revenue),
    }))
  }, [data, monthLabels])

  const creditChartData = useMemo(() => {
    if (!data?.credits_by_year) return []
    return data.credits_by_year.map((r: any) => ({
      year: r.year,
      credit_pct: r.invoice_count > 0 ? Math.round(r.credit_count / r.invoice_count * 1000) / 10 : 0,
      credit_value_pct: r.invoice_total > 0 ? Math.round(r.credit_total / r.invoice_total * 1000) / 10 : 0,
    }))
  }, [data])

  const retentionData = useMemo(() => {
    if (!data?.customer_retention) return []
    return data.customer_retention
  }, [data])

  const ytd = data?.revenue_ytd ?? null

  // Enriched, pre-computed rows for the sortable revenue table.
  //
  // Two things this has to avoid. Comparing against the PREVIOUS ROW silently
  // treats a missing year as if it were last year, so a gap in the data reads as
  // growth. And comparing a year still in progress against a complete one
  // guarantees a double-digit fake decline every January — so the current year
  // is compared year-to-date against the same window a year earlier, which is
  // the number the endpoint computes in `revenue_ytd`.
  const revenueRows = useMemo(() => {
    const byYear = new Map<number, any>(revenueChartData.map((r: any) => [Number(r.year), r]))
    return revenueChartData.map((r: any) => {
      const year = Number(r.year)
      const isPartial = ytd ? year === ytd.year : false
      const prev = byYear.get(year - 1)

      const change = isPartial
        ? ytd?.change ?? null
        : prev && prev.revenue > 0
          ? Math.round((r.revenue - prev.revenue) / prev.revenue * 1000) / 10
          : null

      const avgValue = r.invoices > 0 ? Math.round(r.revenue / r.invoices) : 0
      return { ...r, change, avgValue, isPartial }
    })
  }, [revenueChartData, ytd])

  // "עד 27.8" — a partial year has to say so beside its own figure, not only in
  // a caption someone may not read.
  const throughLabel = useMemo(() => {
    if (!ytd?.through) return null
    const d = new Date(`${ytd.through}T00:00:00`)
    return `${d.getDate()}.${d.getMonth() + 1}`
  }, [ytd])

  const concentrationData = useMemo(() => data?.customer_concentration ?? [], [data])

  const dayOfWeekData = useMemo(() => {
    if (!data?.day_of_week) return []
    const dayNames = isHe
      ? ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    return data.day_of_week.map((r: any) => ({
      day: dayNames[r.day_num],
      avg_revenue: Math.round(r.avg_revenue),
    }))
  }, [data, isHe])

  if (isLoading) return <LoadingSkeleton />
  if (!data || data.error) return (
    <Card className="border-destructive/30">
      <CardContent className="p-8 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-destructive opacity-50" />
        <p className="text-muted-foreground mb-4">{data?.error || (isHe ? 'שגיאה בטעינת הדוח' : 'Error loading report')}</p>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 me-2" />
          {isHe ? 'נסה שוב' : 'Retry'}
        </Button>
      </CardContent>
    </Card>
  )

  const kpis = data.kpis || { monthly_revenue: 0, turnover_ratio: 0, dead_stock_pct_3y: 0, credit_pct: 0, active_items: 0, items_with_stock: 0, inventory_value: 0 }
  const ds = data.dead_stock_summary || { total_inventory_value: 0, no_sales_this_year: 0, no_sales_2y: 0, no_sales_3y: 0, total_items_with_stock: 0 }

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title={t('report')} icon={FileBarChart} />
      {/* The API has reported query_failures for a while; nothing rendered it,
          so a query that failed showed up as a zero on a revenue card and
          nowhere else. On this data an empty result and a quiet month look
          identical — and the empty one is the more believable of the two. */}
      <DataWarning failures={data.query_failures} />

      {/* Section tabs + refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <Tabs value={activeSection} onValueChange={(v) => changeSection(v as Section)}>
        <TabsList className="flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="summary" className="gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('executiveSummary')}</span>
            <span className="sm:hidden">{isHe ? 'סיכום' : 'Summary'}</span>
          </TabsTrigger>
          <TabsTrigger value="deadstock" className="gap-1.5 text-xs">
            <Package className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('deadStock')}</span>
            <span className="sm:hidden">{isHe ? 'מלאי' : 'Stock'}</span>
          </TabsTrigger>
          {!hideDecline && (
            <TabsTrigger value="revenue" className="gap-1.5 text-xs">
              <TrendingDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('revenueDecline')}</span>
              <span className="sm:hidden">{isHe ? 'הכנסות' : 'Revenue'}</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="seasonal" className="gap-1.5 text-xs">
            <Calendar className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('seasonalAnalysis')}</span>
            <span className="sm:hidden">{isHe ? 'עונתי' : 'Seasonal'}</span>
          </TabsTrigger>
          <TabsTrigger value="credits" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('creditNotes')}</span>
            <span className="sm:hidden">{isHe ? 'זיכויים' : 'Credits'}</span>
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('customerAnalysis')}</span>
            <span className="sm:hidden">{isHe ? 'לקוחות' : 'Customers'}</span>
          </TabsTrigger>
          <TabsTrigger value="recommendations" className="gap-1.5 text-xs">
            <Target className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('recommendations')}</span>
            <span className="sm:hidden">{isHe ? 'המלצות' : 'Recs'}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-2">
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            {isHe ? 'עודכן' : 'Updated'} {lastUpdated}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          {isHe ? 'חשב מחדש' : 'Regenerate'}
        </Button>
      </div>
      </div>

      {/* ── Executive Summary ── */}
      {activeSection === 'summary' && (
        <div className="space-y-4 md:space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <KPICard index={0} icon={TrendingUp} label={isHe ? 'הכנסה חודשית ממוצעת' : 'Avg Monthly Revenue'}
              value={formatCurrency(Math.round(kpis.monthly_revenue))}
              sub={isHe ? 'יעד: 1.5M+' : 'Target: 1.5M+'}
              color={kpis.monthly_revenue >= 1500000 ? 'text-emerald-500' : 'text-destructive'} />
            <KPICard index={1} icon={Package} label={t('inventoryTurnover')}
              value={formatNumber(kpis.turnover_ratio, 2)}
              sub={isHe ? 'יעד: 1.0+' : 'Target: 1.0+'}
              color={kpis.turnover_ratio >= 1 ? 'text-emerald-500' : 'text-destructive'} />
            <KPICard index={2} icon={AlertTriangle} label={isHe ? 'מלאי מת 3+ שנים' : 'Dead Stock 3Y+'}
              value={`${kpis.dead_stock_pct_3y}%`}
              sub={formatCurrency(Math.round(ds?.no_sales_3y || 0))}
              color={kpis.dead_stock_pct_3y <= 20 ? 'text-emerald-500' : 'text-destructive'} />
            <KPICard index={3} icon={FileText} label={t('creditRate')}
              value={`${kpis.credit_pct}%`}
              sub={isHe ? 'יעד: <15%' : 'Target: <15%'}
              color={kpis.credit_pct <= 15 ? 'text-emerald-500' : 'text-amber-500'} />
          </div>

          {/* Revenue trend chart */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t('revenueTrend')}
                  {revenueChartData.length > 0 && ` (${revenueChartData[0].year}-${revenueChartData[revenueChartData.length - 1].year})`}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={revenueChartData}>
                    <ChartGrid />
                    <XAxis dataKey="year" {...AXIS_PROPS} />
                    <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v, 'M')} />
                    <Tooltip formatter={(value, name) => [
                      formatCurrency(Number(value)),
                      name === 'revenue' ? (isHe ? 'הכנסות' : 'Revenue') : (isHe ? 'זיכויים' : 'Credits')
                    ]} />
                    <Legend formatter={(v) => v === 'revenue' ? (isHe ? 'הכנסות' : 'Revenue') : (isHe ? 'זיכויים' : 'Credits')} />
                    <Bar activeBar={ACTIVE_BAR} dataKey="revenue" fill="#60a5fa" radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX} animationDuration={800} />
                    <Bar activeBar={ACTIVE_BAR} dataKey="credits" fill="#f87171" radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>

          {/* Revenue table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'מגמת הכנסות' : 'Revenue Trend'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <DataTable<RevenueRow>
                  rows={revenueRows}
                  columns={[
                    {
                      key: 'year',
                      header: isHe ? 'שנה' : 'Year',
                      sortable: true,
                      // A part-year has to carry its own caveat. Read without it,
                      // the last row is just a smaller number than the one above.
                      cell: r => (
                        <span className="font-medium">
                          {r.year}
                          {r.isPartial && throughLabel && (
                            <span className="ms-1 text-xs font-normal text-muted-foreground">
                              ({isHe ? 'עד' : 'to'} {throughLabel})
                            </span>
                          )}
                        </span>
                      ),
                      exportValue: r => (r.isPartial && throughLabel ? `${r.year} (${isHe ? 'עד' : 'to'} ${throughLabel})` : r.year),
                    },
                    { key: 'revenue', header: isHe ? 'הכנסות' : 'Revenue', align: 'end', sortable: true, cell: r => <span className="font-mono">{formatCurrency(r.revenue)}</span>, exportValue: r => r.revenue },
                    {
                      key: 'change',
                      header: t('yearOverYear'),
                      align: 'end',
                      sortable: true,
                      // The first year has no prior year to compare against, so
                      // it has no change — sorted below every real figure rather
                      // than being read as 0% growth.
                      sortValue: r => r.change ?? -Infinity,
                      cell: r =>
                        r.change !== null && (
                          <span className="inline-flex items-center gap-1">
                            <Badge variant={r.change > 0 ? 'success' : 'destructive'}>
                              {r.change > 0 ? '+' : ''}{r.change}%
                            </Badge>
                            {r.isPartial && (
                              <span className="text-xs text-muted-foreground">
                                {isHe ? 'מתחילת השנה' : 'YTD'}
                              </span>
                            )}
                          </span>
                        ),
                      exportValue: r => r.change ?? '',
                    },
                    { key: 'invoices', header: t('invoiceCount'), align: 'end', sortable: true, cell: r => formatNumber(r.invoices), exportValue: r => r.invoices },
                    { key: 'avgValue', header: t('avgInvoiceValue'), align: 'end', sortable: true, cell: r => <span className="font-mono">{formatCurrency(r.avgValue)}</span>, exportValue: r => r.avgValue },
                  ] satisfies DataTableColumn<RevenueRow>[]}
                  getRowKey={r => r.year}
                  defaultSort={{ field: 'year', dir: 'asc' }}
                  minWidth="min-w-[600px]"
                  maxHeight="none"
                  exportFileName={isHe ? 'הכנסות-לפי-שנה' : 'revenue-by-year'}
                />
              </div>
              {/* The basis, stated. This table and the morning brief used to sit
                  on two different tables with two different VAT bases and
                  disagreed about the direction of the year; naming the basis is
                  how a reader can tell the two screens are now the same number. */}
              {ytd && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {isHe
                    ? `כולל מע"מ, לפי תאריך המסמך. ${ytd.year} חלקית — עד ${ytd.through}; השינוי מחושב מול אותה תקופה ב-${ytd.year - 1} (${formatCurrency(ytd.revenue)} מול ${formatCurrency(ytd.prev_revenue)}).`
                    : `VAT-inclusive, by document date. ${ytd.year} is partial — through ${ytd.through}; the change compares the same window in ${ytd.year - 1} (${formatCurrency(ytd.revenue)} vs ${formatCurrency(ytd.prev_revenue)}).`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Inventory summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {t('inventoryHealth')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'ערך מלאי כולל' : 'Total Inventory'}</span>
                  <span className="font-mono font-semibold">{formatCurrency(Math.round(kpis.inventory_value))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'פריטים עם מלאי' : 'Items in Stock'}</span>
                  <span className="font-mono">{formatNumber(kpis.items_with_stock)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'פריטים פעילים' : 'Active Items'}</span>
                  <span className="font-mono">{formatNumber(kpis.active_items)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between text-destructive">
                  <span>{isHe ? 'מלאי מת (ללא מכירות שנה)' : 'Dead (no sales 1Y)'}</span>
                  <span className="font-mono font-semibold">{formatCurrency(Math.round(ds?.no_sales_this_year || 0))}</span>
                </div>
                <div className="flex justify-between text-destructive">
                  <span>{isHe ? 'מלאי מת (3+ שנים)' : 'Dead (3Y+)'}</span>
                  <span className="font-mono font-semibold">{formatCurrency(Math.round(ds?.no_sales_3y || 0))}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  {isHe ? 'סיווג ABC' : 'ABC Classification'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  { label: 'A', data: data.abc_summary.classA, color: 'text-emerald-500', desc: isHe ? '80% מההכנסות' : '80% of revenue' },
                  { label: 'B', data: data.abc_summary.classB, color: 'text-amber-500', desc: isHe ? '15% מההכנסות' : '15% of revenue' },
                  { label: 'C', data: data.abc_summary.classC, color: 'text-muted-foreground', desc: isHe ? '5% מההכנסות' : '5% of revenue' },
                ].map(cls => (
                  <div key={cls.label}>
                    <div className="flex justify-between">
                      <span className={cn('font-semibold', cls.color)}>{isHe ? 'סוג' : 'Class'} {cls.label}</span>
                      <span className="font-mono">{cls.data.count} {isHe ? 'פריטים' : 'items'}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground text-xs">
                      <span>{cls.desc}</span>
                      <span>{formatCurrency(Math.round(cls.data.revenue))}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {isHe ? 'הזמנות ומלאי נכנס' : 'Orders & Incoming'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'פריטים בהזמנה' : 'Items on Order'}</span>
                  <span className="font-mono">{formatNumber(data.open_orders?.items_ordered || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'יחידות בהזמנה' : 'Units Ordered'}</span>
                  <span className="font-mono">{formatNumber(data.open_orders?.total_ordered || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'פריטים בדרך' : 'Items Incoming'}</span>
                  <span className="font-mono">{formatNumber(data.open_orders?.items_incoming || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'יחידות בדרך' : 'Units Incoming'}</span>
                  <span className="font-mono">{formatNumber(data.open_orders?.total_incoming || 0)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between text-amber-500">
                  <span>{isHe ? 'מלאי עודף (3x+)' : 'Overstock (3x+)'}</span>
                  <span className="font-mono font-semibold">{formatNumber(data.overstock?.overstock_count || 0)} {isHe ? 'פריטים' : 'items'}</span>
                </div>
                <div className="flex justify-between text-amber-500">
                  <span>{isHe ? 'ערך מלאי עודף' : 'Overstock Value'}</span>
                  <span className="font-mono font-semibold">{formatCurrency(Math.round(data.overstock?.overstock_value || 0))}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Dead Stock ── */}
      {activeSection === 'deadstock' && (
        <div className="space-y-4 md:space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <KPICard index={0} icon={Package} label={isHe ? 'ערך מלאי כולל' : 'Total Inventory'}
              value={formatCurrency(Math.round(ds?.total_inventory_value || 0))}
              sub={`${formatNumber(ds?.total_items_with_stock || 0)} ${isHe ? 'פריטים' : 'items'}`}
              color="text-primary" />
            <KPICard index={1} icon={AlertTriangle} label={isHe ? 'ללא מכירות שנה' : 'No Sales 1Y'}
              value={formatCurrency(Math.round(ds?.no_sales_this_year || 0))}
              sub={`${ds?.total_inventory_value > 0 ? Math.round(ds.no_sales_this_year / ds.total_inventory_value * 100) : 0}% ${isHe ? 'מהמלאי' : 'of inventory'}`}
              color="text-amber-500" />
            <KPICard index={2} icon={AlertTriangle} label={isHe ? 'ללא מכירות 2+ שנים' : 'No Sales 2Y+'}
              value={formatCurrency(Math.round(ds?.no_sales_2y || 0))}
              sub={`${ds?.total_inventory_value > 0 ? Math.round(ds.no_sales_2y / ds.total_inventory_value * 100) : 0}%`}
              color="text-destructive" />
            <KPICard index={3} icon={AlertTriangle} label={isHe ? 'ללא מכירות 3+ שנים' : 'No Sales 3Y+'}
              value={formatCurrency(Math.round(ds?.no_sales_3y || 0))}
              sub={`${ds?.total_inventory_value > 0 ? Math.round(ds.no_sales_3y / ds.total_inventory_value * 100) : 0}%`}
              color="text-destructive" />
          </div>

          {/* Dead stock breakdown bar */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'התפלגות מלאי' : 'Inventory Breakdown'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: isHe ? 'מלאי פעיל (נמכר השנה)' : 'Active (sold this year)', value: (ds?.total_inventory_value || 0) - (ds?.no_sales_this_year || 0), color: 'bg-emerald-500' },
                  { label: isHe ? 'מת שנה' : 'Dead 1Y', value: (ds?.no_sales_this_year || 0) - (ds?.no_sales_2y || 0), color: 'bg-amber-500' },
                  { label: isHe ? 'מת 2 שנים' : 'Dead 2Y', value: (ds?.no_sales_2y || 0) - (ds?.no_sales_3y || 0), color: 'bg-orange-500' },
                  { label: isHe ? 'מת 3+ שנים' : 'Dead 3Y+', value: ds?.no_sales_3y || 0, color: 'bg-red-500' },
                ].map(segment => {
                  const pct = ds?.total_inventory_value > 0 ? Math.round(segment.value / ds.total_inventory_value * 100) : 0
                  return (
                    <div key={segment.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{segment.label}</span>
                        <span className="font-mono tabular-nums">{formatCurrency(Math.round(segment.value))} ({pct}%)</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <motion.div className={cn('h-full rounded-full', segment.color)}
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: 0.2 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Top dead stock items table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'Top 50 פריטי מלאי מת (3+ שנים)' : 'Top 50 Dead Stock Items (3Y+)'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto -mx-4 md:mx-0">
                <DataTable<ReportDeadStockRow>
                  rows={data.top_dead_stock}
                  columns={[
                    { key: 'rank', header: '#', cell: (_r, i) => <span className="text-muted-foreground">{i + 1}</span>, exportValue: (_r, i) => i + 1 },
                    { key: 'item_code', header: isHe ? 'קוד' : 'Code', sortable: true, cell: item => <span className="font-mono text-xs">{item.item_code}</span>, exportValue: item => item.item_code },
                    { key: 'item_name', header: isHe ? 'תיאור' : 'Description', sortable: true, truncate: 'max-w-[200px]', title: item => item.item_name, cell: item => item.item_name, exportValue: item => item.item_name },
                    { key: 'qty', header: isHe ? 'כמות' : 'Qty', align: 'end', sortable: true, cell: item => formatNumber(item.qty), exportValue: item => item.qty },
                    { key: 'retail_price', header: isHe ? 'מחיר' : 'Price', align: 'end', sortable: true, cell: item => <span className="font-mono">{formatCurrency(Math.round(item.retail_price))}</span>, exportValue: item => item.retail_price },
                    {
                      key: 'capital_tied',
                      header: isHe ? 'הון כלוא' : 'Capital Tied',
                      align: 'end',
                      sortable: true,
                      cell: item => <span className="font-mono font-semibold text-destructive">{formatCurrency(Math.round(item.capital_tied))}</span>,
                      exportValue: item => item.capital_tied,
                    },
                  ] satisfies DataTableColumn<ReportDeadStockRow>[]}
                  getRowKey={item => item.item_code}
                  defaultSort={{ field: 'capital_tied', dir: 'desc' }}
                  minWidth="min-w-[600px]"
                  maxHeight="none"
                  exportFileName={isHe ? 'מלאי-מת-Top50' : 'top-dead-stock'}
                  // Totals the WHOLE list, not the visible page — a "Top 50"
                  // total that moved when you sorted would be worse than none.
                  footer={(_shown, all) =>
                    all.length > 0 ? (
                      <tr className="border-t-2 font-semibold">
                        <td colSpan={5} className="py-2">{isHe ? 'סה"כ Top 50' : 'Total Top 50'}</td>
                        <td className="py-2 text-end font-mono text-destructive">
                          {formatCurrency(Math.round(all.reduce((sum, i) => sum + i.capital_tied, 0)))}
                        </td>
                      </tr>
                    ) : null
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Recommendations */}
          <Card className="border-destructive/30 bg-destructive/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {isHe ? 'המלצות מלאי מת' : 'Dead Stock Recommendations'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(isHe ? [
                  'מכירת חיסול מיידית - הנחות 40-70% על 50 הפריטים הגדולים (פוטנציאל שחרור 1-1.5M ₪)',
                  'החזרה לספקים - לבדוק אפשרות החזרה לפריטים שנרכשו ב-2-3 שנים האחרונות',
                  'מכירה לפירוק/גריטה - פריטים ללא תנועה 5+ שנים',
                  'מכירה בין-חנויות - לפרסם ברשתות חלפים מקצועיות',
                  'הפסקת הזמנות - לעצור הזמנות לפריטים עם מלאי ל-3+ שנות מכירה',
                ] : [
                  'Immediate clearance sale - 40-70% discounts on top 50 items (potential release of 1-1.5M ILS)',
                  'Return to suppliers - check return options for items purchased in last 2-3 years',
                  'Sell for scrap/dismantling - items with 5+ years no movement',
                  'Inter-store sales - advertise on professional auto parts networks',
                  'Stop ordering - freeze orders for items with 3+ years of stock coverage',
                ]).map((rec, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                    <span>{maskMoneyInText(rec)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Revenue Decline ── */}
      {activeSection === 'revenue' && (
        <div className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{`${isHe ? 'השוואה חודשית' : 'Monthly Comparison'} - ${compareYears.prev2} vs ${compareYears.prev} vs ${compareYears.cur}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={monthlyCompare}>
                  <ChartGrid />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)} />
                  <Tooltip formatter={(value: any) => [formatCurrency(value), '']} />
                  <Legend />
                  <Line activeDot={ACTIVE_DOT} type="monotone" dataKey="prev2" name={String(compareYears.prev2)} stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} animationDuration={800} />
                  <Line activeDot={ACTIVE_DOT} type="monotone" dataKey="prev" name={String(compareYears.prev)} stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} animationDuration={800} />
                  <Line activeDot={ACTIVE_DOT} type="monotone" dataKey="cur" name={String(compareYears.cur)} stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} animationDuration={800} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Monthly comparison table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{`${isHe ? 'השוואה חודשית' : 'Monthly'} ${compareYears.cur} vs ${compareYears.prev}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <DataTable<MonthlyCompareRow>
                  rows={monthlyCompare}
                  columns={[
                    { key: 'month', header: isHe ? 'חודש' : 'Month', cell: m => m.month, exportValue: m => m.month },
                    { key: 'prev', header: String(compareYears.prev), align: 'end', sortable: true, sortValue: m => m.prev, cell: m => <span className="font-mono">{m.prev > 0 ? formatCurrency(m.prev) : '—'}</span>, exportValue: m => m.prev },
                    { key: 'cur', header: String(compareYears.cur), align: 'end', sortable: true, sortValue: m => m.cur, cell: m => <span className="font-mono">{m.cur > 0 ? formatCurrency(m.cur) : '—'}</span>, exportValue: m => m.cur },
                    {
                      key: 'change',
                      header: isHe ? 'שינוי' : 'Change',
                      align: 'end',
                      sortable: true,
                      // A month with no 2024 base has no percentage change; it
                      // sorts below the real ones instead of reading as flat.
                      sortValue: m => (m.prev > 0 && m.cur > 0 ? (m.cur - m.prev) / m.prev : -Infinity),
                      cell: m => {
                        const change = m.prev > 0 ? Math.round(((m.cur - m.prev) / m.prev) * 1000) / 10 : null
                        return change !== null && m.cur > 0 ? (
                          <Badge variant={change > 0 ? 'success' : 'destructive'}>
                            {change > 0 ? '+' : ''}{change}%
                          </Badge>
                        ) : null
                      },
                      exportValue: m => (m.prev > 0 ? Math.round(((m.cur - m.prev) / m.prev) * 1000) / 10 : ''),
                    },
                  ] satisfies DataTableColumn<MonthlyCompareRow>[]}
                  getRowKey={(m, i) => m.month ?? i}
                  // No defaultSort: the rows are already in calendar order, and
                  // a month table read out of calendar order is a puzzle.
                  minWidth="min-w-[500px]"
                  maxHeight="none"
                  exportFileName={isHe ? 'השוואה-חודשית' : 'monthly-comparison'}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <TrendingDown className="h-4 w-4" />
                {isHe ? 'המלצות להגדלת הכנסות' : 'Revenue Growth Recommendations'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(isHe ? [
                  'ניתוח סיבת הירידה - האם זה שוק? מתחרים? אובדן לקוחות? מחסור במלאי של פריטים מבוקשים?',
                  'קמפיין Win-Back - לקוחות שקנו ב-2023-2024 ולא ב-2025',
                  'Q4 Recovery Plan - דצמבר הוא החודש הכי חזק היסטורית. להכין מבצעים מוקדם',
                  'ניתוח שער הצלחה הצעות מחיר - כמה הצעות הופכות לחשבוניות?',
                ] : [
                  'Analyze root cause of decline - market? competitors? customer loss? stock shortages?',
                  'Win-Back campaign - customers who bought in 2023-2024 but not 2025',
                  'Q4 Recovery Plan - December is historically strongest. Prepare promotions early',
                  'Quote conversion analysis - what percentage of quotes convert to invoices?',
                ]).map((rec, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Seasonal ── */}
      {activeSection === 'seasonal' && (
        <div className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'ממוצע הכנסות חודשי (רב-שנתי)' : 'Monthly Revenue Average (Multi-Year)'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={seasonalData}>
                  <ChartGrid />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)} />
                  <Tooltip formatter={(value: any) => [formatCurrency(value), isHe ? 'ממוצע' : 'Average']} />
                  <Bar activeBar={ACTIVE_BAR} dataKey="avg_revenue" radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX} animationDuration={800}>
                    {seasonalData.map((_: any, i: number) => (
                      <Cell key={i} fill={[10, 11].includes(i) ? '#34d399' : [3].includes(i) ? '#f87171' : '#60a5fa'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{isHe ? 'הכנסות לפי יום בשבוע' : 'Revenue by Day of Week'}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dayOfWeekData}>
                    <ChartGrid />
                    <XAxis dataKey="day" {...AXIS_PROPS} />
                    <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)} />
                    <Tooltip formatter={(value: any) => [formatCurrency(value), isHe ? 'ממוצע' : 'Average']} />
                    <Bar activeBar={ACTIVE_BAR} dataKey="avg_revenue" fill="#a78bfa" radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <Calendar className="h-4 w-4" />
                  {isHe ? 'המלצות עונתיות' : 'Seasonal Recommendations'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {(isHe ? [
                    'אפריל = חודש מבצעים - החודש הכי חלש, נצל להמריץ מכירות',
                    'הכנה ל-Q4 - להגדיל מלאי של פריטי A באוקטובר',
                    'ימי ראשון - היום הכי חזק. לתת עדיפות לכ"א ושיווק בתחילת השבוע',
                    'נובמבר-דצמבר - החודשים הכי חזקים. למקסם מבצעים ופעילות',
                  ] : [
                    'April = promotions month - weakest month, use for stimulating sales',
                    'Q4 preparation - increase A-item stock in October',
                    'Sundays - strongest day. Prioritize staffing and marketing early in the week',
                    'November-December - strongest months. Maximize promotions and activity',
                  ]).map((rec, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Credit Notes ── */}
      {activeSection === 'credits' && (
        <div className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'מגמת זיכויים לאורך שנים' : 'Credit Notes Trend Over Years'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={creditChartData}>
                  <ChartGrid />
                  <XAxis dataKey="year" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(value, name) => [
                    `${value}%`,
                    name === 'credit_pct' ? (isHe ? '% כמות' : '% Count') : (isHe ? '% ערך' : '% Value')
                  ]} />
                  <Legend formatter={(v) => v === 'credit_pct' ? (isHe ? '% זיכויים (כמות)' : 'Credit % (Count)') : (isHe ? '% זיכויים (ערך)' : 'Credit % (Value)')} />
                  <Line activeDot={ACTIVE_DOT} type="monotone" dataKey="credit_pct" stroke="#f87171" strokeWidth={2} dot={{ r: 4 }} animationDuration={800} />
                  <Line activeDot={ACTIVE_DOT} type="monotone" dataKey="credit_value_pct" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} animationDuration={800} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'ניתוח זיכויים לפי שנה' : 'Credit Notes by Year'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <DataTable<CreditsByYearRow>
                  rows={data.credits_by_year}
                  columns={[
                    { key: 'year', header: isHe ? 'שנה' : 'Year', sortable: true, cell: r => <span className="font-medium">{r.year}</span>, exportValue: r => r.year },
                    { key: 'invoice_count', header: isHe ? 'חשבוניות' : 'Invoices', align: 'end', sortable: true, cell: r => formatNumber(r.invoice_count), exportValue: r => r.invoice_count },
                    { key: 'credit_count', header: isHe ? 'זיכויים' : 'Credits', align: 'end', sortable: true, cell: r => formatNumber(r.credit_count), exportValue: r => r.credit_count },
                    {
                      key: 'countPct',
                      header: isHe ? '% כמות' : '% Count',
                      align: 'end',
                      sortable: true,
                      sortValue: r => (r.invoice_count > 0 ? r.credit_count / r.invoice_count : 0),
                      cell: r => {
                        const pct = r.invoice_count > 0 ? Math.round((r.credit_count / r.invoice_count) * 1000) / 10 : 0
                        return <Badge variant={pct > 18 ? 'destructive' : pct > 15 ? 'warning' : 'success'}>{pct}%</Badge>
                      },
                      exportValue: r => (r.invoice_count > 0 ? Math.round((r.credit_count / r.invoice_count) * 1000) / 10 : 0),
                    },
                    {
                      key: 'valuePct',
                      header: isHe ? '% ערך' : '% Value',
                      align: 'end',
                      sortable: true,
                      sortValue: r => (r.invoice_total > 0 ? r.credit_total / r.invoice_total : 0),
                      cell: r => {
                        const pct = r.invoice_total > 0 ? Math.round((r.credit_total / r.invoice_total) * 1000) / 10 : 0
                        return <Badge variant={pct > 12 ? 'destructive' : pct > 10 ? 'warning' : 'success'}>{pct}%</Badge>
                      },
                      exportValue: r => (r.invoice_total > 0 ? Math.round((r.credit_total / r.invoice_total) * 1000) / 10 : 0),
                    },
                  ] satisfies DataTableColumn<CreditsByYearRow>[]}
                  getRowKey={r => r.year}
                  defaultSort={{ field: 'year', dir: 'asc' }}
                  minWidth="min-w-[600px]"
                  maxHeight="none"
                  exportFileName={isHe ? 'זיכויים-לפי-שנה' : 'credits-by-year'}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-500/30 bg-red-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                {isHe ? 'המלצות זיכויים' : 'Credit Notes Recommendations'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(isHe ? [
                  'ניתוח סיבות זיכוי - האם זה החזרות? טעויות? מחירים? לתייג זיכויים עם קוד סיבה',
                  'יעד: הפחתה ל-15% - חיסכון של ~1,700 זיכויים/שנה',
                  'בדיקת חשבוניות לפני שליחה - מנגנון אישור למניעת טעויות',
                  'ניתוח לפי לקוח - האם יש לקוחות ספציפיים עם שיעור זיכוי גבוה?',
                ] : [
                  'Analyze credit reasons - returns? errors? pricing? Tag credits with reason codes',
                  'Target: reduce to 15% - saving ~1,700 credits/year',
                  'Invoice review before sending - approval mechanism to prevent errors',
                  'Per-customer analysis - are specific customers responsible for high credit rates?',
                ]).map((rec, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Customer Analysis ── */}
      {activeSection === 'customers' && (
        <div className="space-y-4 md:space-y-6">
          {/* Retention chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'שימור לקוחות לאורך שנים' : 'Customer Retention Over Years'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={retentionData}>
                  <ChartGrid />
                  <XAxis dataKey="year" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} allowDecimals={false} />
                  <Tooltip />
                  <Legend formatter={(v) => {
                    if (v === 'returning_customers') return isHe ? 'לקוחות חוזרים' : 'Returning'
                    if (v === 'new_customers') return isHe ? 'לקוחות חדשים' : 'New'
                    return v
                  }} />
                  <Bar activeBar={ACTIVE_BAR} dataKey="returning_customers" stackId="a" fill="#60a5fa" maxBarSize={BAR_MAX} animationDuration={800} />
                  <Bar activeBar={ACTIVE_BAR} dataKey="new_customers" stackId="a" fill="#34d399" radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX} animationDuration={800} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Retention table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'פירוט שימור לקוחות' : 'Customer Retention Details'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <DataTable<RetentionRow>
                  rows={retentionData}
                  columns={[
                    { key: 'year', header: isHe ? 'שנה' : 'Year', sortable: true, cell: r => <span className="font-medium">{r.year}</span>, exportValue: r => r.year },
                    { key: 'total_customers', header: isHe ? 'לקוחות' : 'Customers', align: 'end', sortable: true, cell: r => formatNumber(r.total_customers), exportValue: r => r.total_customers },
                    {
                      key: 'new_customers',
                      header: t('newCustomers'),
                      align: 'end',
                      sortable: true,
                      cell: r => (
                        <Badge variant={r.new_customers >= 50 ? 'success' : r.new_customers >= 30 ? 'warning' : 'destructive'}>
                          {formatNumber(r.new_customers)}
                        </Badge>
                      ),
                      exportValue: r => r.new_customers,
                    },
                    { key: 'returning_customers', header: t('returningCustomers'), align: 'end', sortable: true, cell: r => formatNumber(r.returning_customers), exportValue: r => r.returning_customers },
                    {
                      key: 'retention_pct',
                      header: t('retentionRate'),
                      align: 'end',
                      sortable: true,
                      // The first year has nothing to retain FROM, so its rate
                      // is null — kept below the real rates rather than 0%.
                      sortValue: r => r.retention_pct ?? -Infinity,
                      cell: r =>
                        r.retention_pct !== null ? (
                          <Badge variant={r.retention_pct >= 80 ? 'success' : 'warning'}>{r.retention_pct}%</Badge>
                        ) : (
                          '—'
                        ),
                      exportValue: r => r.retention_pct ?? '',
                    },
                    { key: 'total_revenue', header: isHe ? 'הכנסות' : 'Revenue', align: 'end', sortable: true, cell: r => <span className="font-mono">{formatCurrency(Math.round(r.total_revenue))}</span>, exportValue: r => r.total_revenue },
                  ] satisfies DataTableColumn<RetentionRow>[]}
                  getRowKey={r => r.year}
                  defaultSort={{ field: 'year', dir: 'asc' }}
                  minWidth="min-w-[600px]"
                  maxHeight="none"
                  exportFileName={isHe ? 'שימור-לקוחות' : 'customer-retention'}
                />
              </div>
            </CardContent>
          </Card>

          {/* Concentration table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'ריכוזיות לקוחות לפי שנה' : 'Customer Concentration by Year'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <DataTable<ConcentrationRow>
                  rows={concentrationData}
                  columns={[
                    { key: 'year', header: isHe ? 'שנה' : 'Year', sortable: true, cell: r => <span className="font-medium">{r.year}</span>, exportValue: r => r.year },
                    {
                      key: 'top5_pct',
                      header: 'Top 5 %',
                      align: 'end',
                      sortable: true,
                      cell: r => <Badge variant={r.top5_pct >= 70 ? 'destructive' : r.top5_pct >= 50 ? 'warning' : 'success'}>{r.top5_pct}%</Badge>,
                      exportValue: r => r.top5_pct,
                    },
                    {
                      key: 'top10_pct',
                      header: 'Top 10 %',
                      align: 'end',
                      sortable: true,
                      cell: r => <Badge variant={r.top10_pct >= 80 ? 'destructive' : r.top10_pct >= 60 ? 'warning' : 'success'}>{r.top10_pct}%</Badge>,
                      exportValue: r => r.top10_pct,
                    },
                    { key: 'total_customers', header: isHe ? 'סה"כ לקוחות' : 'Total Customers', align: 'end', sortable: true, cell: r => formatNumber(r.total_customers), exportValue: r => r.total_customers },
                  ] satisfies DataTableColumn<ConcentrationRow>[]}
                  getRowKey={r => r.year}
                  defaultSort={{ field: 'year', dir: 'asc' }}
                  minWidth="min-w-[500px]"
                  maxHeight="none"
                  exportFileName={isHe ? 'ריכוזיות-לקוחות' : 'customer-concentration'}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-500/30 bg-purple-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-purple-600 dark:text-purple-400">
                <Users className="h-4 w-4" />
                {isHe ? 'המלצות לקוחות' : 'Customer Recommendations'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(isHe ? [
                  'גיוון בסיס לקוחות - הסיכון העסקי הכי גדול. להשקיע בשיווק ופיתוח לקוחות חדשים',
                  'VIP Program - ל-5 לקוחות המובילים: הנחות נפח, עדיפות במשלוחים, מנהל חשבון ייעודי',
                  'Win-Back Campaign - לפנות ל-80 לקוחות שהפסיקו לקנות',
                  'Cross-sell - לנתח מה כל לקוח גדול קונה, ולהציע פריטים משלימים',
                  'התראות נטישה - מערכת שמזהה כשלקוח גדול מפחית קניות',
                ] : [
                  'Diversify customer base - biggest business risk. Invest in marketing and new customer acquisition',
                  'VIP Program - for top 5 customers: volume discounts, delivery priority, dedicated account manager',
                  'Win-Back Campaign - reach out to ~80 customers who stopped buying',
                  'Cross-sell - analyze what each major customer buys, suggest complementary items',
                  'Churn alerts - system that detects when a major customer reduces purchases',
                ]).map((rec, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-purple-600 dark:text-purple-400" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Recommendations ── */}
      {activeSection === 'recommendations' && (
        <div className="space-y-4 md:space-y-6">
          {/* Urgent */}
          <Card className="border-destructive/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Badge variant="destructive">{t('urgent')}</Badge>
                {isHe ? 'אפקט מיידי על תזרים' : 'Immediate Cash Flow Impact'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">#</th>
                      <th className="pb-2 font-medium text-start">{isHe ? 'פעולה' : 'Action'}</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'אפקט צפוי' : 'Expected Impact'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isHe ? [
                      { action: 'מכירת חיסול ל-50 פריטי מלאי מת גדולים', impact: 'שחרור 1-1.5M ₪' },
                      { action: 'ביטול הזמנות לפריטים עם מלאי עודף', impact: 'חיסכון 500K+ ₪' },
                      { action: 'הקפאת הזמנות לפריטי C', impact: 'חיסכון 200K+ ₪/שנה' },
                      { action: 'Win-back ל-5 לקוחות מובילים שירדו', impact: 'פוטנציאל 500K-1M ₪' },
                    ] : [
                      { action: 'Clearance sale for top 50 dead stock items', impact: 'Release 1-1.5M ILS' },
                      { action: 'Cancel orders for overstocked items', impact: 'Save 500K+ ILS' },
                      { action: 'Freeze orders for C-class items', impact: 'Save 200K+ ILS/year' },
                      { action: 'Win-back top 5 declining customers', impact: 'Potential 500K-1M ILS' },
                    ]).map((r, i) => (
                      <tr key={i} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 ps-4 md:ps-0 font-bold text-destructive align-top">{i + 1}</td>
                        <td className="py-2.5">
                          <ActionPlaybook action={r.action} impact={r.impact} isHe={isHe}>{r.action}</ActionPlaybook>
                        </td>
                        <td className="py-2.5 text-end font-semibold pe-4 md:pe-0 align-top">{maskMoneyInText(r.impact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Important */}
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Badge variant="warning">{t('important')}</Badge>
                {isHe ? 'אפקט בינוני-ארוך טווח' : 'Medium-Long Term Impact'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">#</th>
                      <th className="pb-2 font-medium text-start">{isHe ? 'פעולה' : 'Action'}</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'אפקט צפוי' : 'Expected Impact'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isHe ? [
                      { action: 'ניתוח סיבות זיכויים + הפחתה ל-15%', impact: 'חיסכון ~500K ₪/שנה' },
                      { action: 'גיוון בסיס לקוחות - שיווק דיגיטלי', impact: 'הפחתת סיכון + צמיחה' },
                      { action: 'מעבר ל-JIT לפריטי C', impact: 'צמצום מלאי 2-3M ₪' },
                      { action: 'מדיניות הזמנות מבוססת נתונים', impact: 'מניעת הצטברות מלאי' },
                    ] : [
                      { action: 'Analyze credit note reasons + reduce to 15%', impact: 'Save ~500K ILS/year' },
                      { action: 'Diversify customer base - digital marketing', impact: 'Risk reduction + growth' },
                      { action: 'Move C-class items to JIT ordering', impact: 'Reduce inventory by 2-3M ILS' },
                      { action: 'Data-driven ordering policy', impact: 'Prevent future stock buildup' },
                    ]).map((r, i) => (
                      <tr key={i} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 ps-4 md:ps-0 font-bold text-amber-500 align-top">{i + 5}</td>
                        <td className="py-2.5">
                          <ActionPlaybook action={r.action} impact={r.impact} isHe={isHe}>{r.action}</ActionPlaybook>
                        </td>
                        <td className="py-2.5 text-end font-semibold pe-4 md:pe-0 align-top">{maskMoneyInText(r.impact)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* KPI Targets */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />
                {t('kpiTargets')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">KPI</th>
                      <th className="pb-2 font-medium text-end">{t('currentState')}</th>
                      <th className="pb-2 font-medium text-end">{t('target')}</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'מצב' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {
                        kpi: isHe ? 'הכנסה חודשית' : 'Monthly Revenue',
                        current: `~${formatCurrency(Math.round(kpis.monthly_revenue))}`,
                        target: '1.5M+',
                        met: kpis.monthly_revenue >= 1500000,
                      },
                      {
                        kpi: isHe ? 'מחזור מלאי שנתי' : 'Annual Inventory Turnover',
                        current: formatNumber(kpis.turnover_ratio, 2),
                        target: '1.0+',
                        met: kpis.turnover_ratio >= 1,
                      },
                      {
                        kpi: isHe ? '% מלאי מת (3+ שנים)' : 'Dead Stock % (3Y+)',
                        current: `${kpis.dead_stock_pct_3y}%`,
                        target: '<20%',
                        met: kpis.dead_stock_pct_3y <= 20,
                      },
                      {
                        kpi: isHe ? '% זיכויים מחשבוניות' : 'Credit Note %',
                        current: `${kpis.credit_pct}%`,
                        target: '<15%',
                        met: kpis.credit_pct <= 15,
                      },
                      {
                        kpi: isHe ? 'לקוחות חדשים/שנה' : 'New Customers/Year',
                        current: `~${retentionData.length > 0 ? retentionData[retentionData.length - 1].new_customers : '?'}`,
                        target: '80+',
                        met: (retentionData.length > 0 ? retentionData[retentionData.length - 1].new_customers : 0) >= 80,
                      },
                    ].map((row, i) => (
                      <tr key={i} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 ps-4 md:ps-0 font-medium">{row.kpi}</td>
                        <td className="py-2.5 text-end font-mono tabular-nums">{row.current}</td>
                        <td className="py-2.5 text-end font-mono tabular-nums">{row.target}</td>
                        <td className="py-2.5 text-end pe-4 md:pe-0">
                          <Badge variant={row.met ? 'success' : 'destructive'}>
                            {row.met ? (isHe ? 'עומד ביעד' : 'On Target') : (isHe ? 'לא עומד' : 'Off Target')}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

/** Rows of the six data tables on this page. The endpoint is loosely typed;
 *  these name only the fields the tables actually read. */
interface RevenueRow {
  year: number | string
  revenue: number
  invoices: number
  /**
   * Year-over-year %, null when the prior year is absent — nothing to compare
   * against. For the year still in progress this is the year-to-date change
   * against the same window last year, not part-year against whole-year.
   */
  change: number | null
  avgValue: number
  /** The year is still running (or the data stops inside it). */
  isPartial?: boolean
}
interface ReportDeadStockRow {
  item_code: string
  item_name: string
  qty: number
  retail_price: number
  capital_tied: number
}
interface MonthlyCompareRow {
  month: string
  /** The two years before the latest one present in the data, and the latest. */
  prev2: number
  prev: number
  cur: number
}
interface CreditsByYearRow {
  year: number | string
  invoice_count: number
  credit_count: number
  invoice_total: number
  credit_total: number
}
interface RetentionRow {
  year: number | string
  total_customers: number
  new_customers: number
  returning_customers: number
  retention_pct: number | null
  total_revenue: number
}
interface ConcentrationRow {
  year: number | string
  top5_pct: number
  top10_pct: number
  total_customers: number
}

export default function ReportPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ReportContent />
    </Suspense>
  )
}
