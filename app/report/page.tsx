'use client'

import { Suspense, useState, useMemo } from 'react'
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
import { ILS_FORMAT, NUMBER_FORMAT } from '@/lib/constants'
import {
  TrendingUp, TrendingDown, AlertTriangle, Package, Users, FileText,
  BarChart3, Calendar, Target, ArrowRight, RefreshCw,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, AreaChart, Area, Cell, PieChart, Pie,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'

const MONTH_LABELS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const tooltipStyle = {
  backgroundColor: 'var(--popover)',
  borderColor: 'var(--border)',
  borderRadius: '8px',
  color: 'var(--popover-foreground)',
}

type Section = 'summary' | 'deadstock' | 'revenue' | 'seasonal' | 'credits' | 'customers' | 'recommendations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.06, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

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
  const { t, locale } = useLocale()
  const isHe = locale === 'he'
  const monthLabels = isHe ? MONTH_LABELS_HE : MONTH_LABELS_EN
  const { data, isLoading, isFetching, dataUpdatedAt } = useBusinessReport()
  const queryClient = useQueryClient()
  const [section, setSection] = useState<Section>('summary')

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

  const monthlyCompare = useMemo(() => {
    if (!data?.monthly_revenue) return []
    const byYearMonth: Record<string, Record<number, number>> = {}
    for (const r of data.monthly_revenue) {
      if (!byYearMonth[r.year]) byYearMonth[r.year] = {}
      byYearMonth[r.year][r.month] = Math.round(r.revenue)
    }
    return Array.from({ length: 12 }, (_, i) => ({
      month: monthLabels[i],
      '2023': byYearMonth['2023']?.[i + 1] || 0,
      '2024': byYearMonth['2024']?.[i + 1] || 0,
      '2025': byYearMonth['2025']?.[i + 1] || 0,
    }))
  }, [data, monthLabels])

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
      {/* Section tabs + refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
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
          <TabsTrigger value="revenue" className="gap-1.5 text-xs">
            <TrendingDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('revenueDecline')}</span>
            <span className="sm:hidden">{isHe ? 'הכנסות' : 'Revenue'}</span>
          </TabsTrigger>
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
      {section === 'summary' && (
        <div className="space-y-4 md:space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <KPICard index={0} icon={TrendingUp} label={isHe ? 'הכנסה חודשית ממוצעת' : 'Avg Monthly Revenue'}
              value={ILS_FORMAT.format(Math.round(kpis.monthly_revenue))}
              sub={isHe ? 'יעד: 1.5M+' : 'Target: 1.5M+'}
              color={kpis.monthly_revenue >= 1500000 ? 'text-emerald-500' : 'text-destructive'} />
            <KPICard index={1} icon={Package} label={t('inventoryTurnover')}
              value={kpis.turnover_ratio.toFixed(2)}
              sub={isHe ? 'יעד: 1.0+' : 'Target: 1.0+'}
              color={kpis.turnover_ratio >= 1 ? 'text-emerald-500' : 'text-destructive'} />
            <KPICard index={2} icon={AlertTriangle} label={isHe ? 'מלאי מת 3+ שנים' : 'Dead Stock 3Y+'}
              value={`${kpis.dead_stock_pct_3y}%`}
              sub={ILS_FORMAT.format(Math.round(ds?.no_sales_3y || 0))}
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
                <CardTitle className="text-base">{t('revenueTrend')} (2020-2026)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={revenueChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: string) => [
                      name === 'credits' ? ILS_FORMAT.format(value) : ILS_FORMAT.format(value),
                      name === 'revenue' ? (isHe ? 'הכנסות' : 'Revenue') : (isHe ? 'זיכויים' : 'Credits')
                    ]} />
                    <Legend formatter={(v) => v === 'revenue' ? (isHe ? 'הכנסות' : 'Revenue') : (isHe ? 'זיכויים' : 'Credits')} />
                    <Bar dataKey="revenue" fill="#60a5fa" radius={[4, 4, 0, 0]} animationDuration={800} />
                    <Bar dataKey="credits" fill="#f87171" radius={[4, 4, 0, 0]} animationDuration={800} />
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
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">{isHe ? 'שנה' : 'Year'}</th>
                      <th className="pb-2 font-medium text-end">{isHe ? 'הכנסות' : 'Revenue'}</th>
                      <th className="pb-2 font-medium text-end">{t('yearOverYear')}</th>
                      <th className="pb-2 font-medium text-end">{t('invoiceCount')}</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{t('avgInvoiceValue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueChartData.map((r: any, i: number) => {
                      const prev = i > 0 ? revenueChartData[i - 1] : null
                      const change = prev ? Math.round((r.revenue - prev.revenue) / prev.revenue * 1000) / 10 : null
                      const avgValue = r.invoices > 0 ? Math.round(r.revenue / r.invoices) : 0
                      return (
                        <tr key={r.year} className="border-b hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 ps-4 md:ps-0 font-medium">{r.year}</td>
                          <td className="py-2.5 text-end font-mono tabular-nums">{ILS_FORMAT.format(r.revenue)}</td>
                          <td className="py-2.5 text-end">
                            {change !== null && (
                              <Badge variant={change > 0 ? 'success' : 'destructive'}>
                                {change > 0 ? '+' : ''}{change}%
                              </Badge>
                            )}
                          </td>
                          <td className="py-2.5 text-end tabular-nums">{NUMBER_FORMAT.format(r.invoices)}</td>
                          <td className="py-2.5 text-end font-mono tabular-nums pe-4 md:pe-0">{ILS_FORMAT.format(avgValue)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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
                  <span className="font-mono font-semibold">{ILS_FORMAT.format(Math.round(kpis.inventory_value))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'פריטים עם מלאי' : 'Items in Stock'}</span>
                  <span className="font-mono">{NUMBER_FORMAT.format(kpis.items_with_stock)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'פריטים פעילים' : 'Active Items'}</span>
                  <span className="font-mono">{NUMBER_FORMAT.format(kpis.active_items)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between text-destructive">
                  <span>{isHe ? 'מלאי מת (ללא מכירות שנה)' : 'Dead (no sales 1Y)'}</span>
                  <span className="font-mono font-semibold">{ILS_FORMAT.format(Math.round(ds?.no_sales_this_year || 0))}</span>
                </div>
                <div className="flex justify-between text-destructive">
                  <span>{isHe ? 'מלאי מת (3+ שנים)' : 'Dead (3Y+)'}</span>
                  <span className="font-mono font-semibold">{ILS_FORMAT.format(Math.round(ds?.no_sales_3y || 0))}</span>
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
                      <span>{ILS_FORMAT.format(Math.round(cls.data.revenue))}</span>
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
                  <span className="font-mono">{NUMBER_FORMAT.format(data.open_orders?.items_ordered || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'יחידות בהזמנה' : 'Units Ordered'}</span>
                  <span className="font-mono">{NUMBER_FORMAT.format(data.open_orders?.total_ordered || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'פריטים בדרך' : 'Items Incoming'}</span>
                  <span className="font-mono">{NUMBER_FORMAT.format(data.open_orders?.items_incoming || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isHe ? 'יחידות בדרך' : 'Units Incoming'}</span>
                  <span className="font-mono">{NUMBER_FORMAT.format(data.open_orders?.total_incoming || 0)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between text-amber-500">
                  <span>{isHe ? 'מלאי עודף (3x+)' : 'Overstock (3x+)'}</span>
                  <span className="font-mono font-semibold">{NUMBER_FORMAT.format(data.overstock?.overstock_count || 0)} {isHe ? 'פריטים' : 'items'}</span>
                </div>
                <div className="flex justify-between text-amber-500">
                  <span>{isHe ? 'ערך מלאי עודף' : 'Overstock Value'}</span>
                  <span className="font-mono font-semibold">{ILS_FORMAT.format(Math.round(data.overstock?.overstock_value || 0))}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Dead Stock ── */}
      {section === 'deadstock' && (
        <div className="space-y-4 md:space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            <KPICard index={0} icon={Package} label={isHe ? 'ערך מלאי כולל' : 'Total Inventory'}
              value={ILS_FORMAT.format(Math.round(ds?.total_inventory_value || 0))}
              sub={`${NUMBER_FORMAT.format(ds?.total_items_with_stock || 0)} ${isHe ? 'פריטים' : 'items'}`}
              color="text-primary" />
            <KPICard index={1} icon={AlertTriangle} label={isHe ? 'ללא מכירות שנה' : 'No Sales 1Y'}
              value={ILS_FORMAT.format(Math.round(ds?.no_sales_this_year || 0))}
              sub={`${ds?.total_inventory_value > 0 ? Math.round(ds.no_sales_this_year / ds.total_inventory_value * 100) : 0}% ${isHe ? 'מהמלאי' : 'of inventory'}`}
              color="text-amber-500" />
            <KPICard index={2} icon={AlertTriangle} label={isHe ? 'ללא מכירות 2+ שנים' : 'No Sales 2Y+'}
              value={ILS_FORMAT.format(Math.round(ds?.no_sales_2y || 0))}
              sub={`${ds?.total_inventory_value > 0 ? Math.round(ds.no_sales_2y / ds.total_inventory_value * 100) : 0}%`}
              color="text-destructive" />
            <KPICard index={3} icon={AlertTriangle} label={isHe ? 'ללא מכירות 3+ שנים' : 'No Sales 3Y+'}
              value={ILS_FORMAT.format(Math.round(ds?.no_sales_3y || 0))}
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
                        <span className="font-mono tabular-nums">{ILS_FORMAT.format(Math.round(segment.value))} ({pct}%)</span>
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
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">#</th>
                      <th className="pb-2 font-medium text-start">{isHe ? 'קוד' : 'Code'}</th>
                      <th className="pb-2 font-medium text-start">{isHe ? 'תיאור' : 'Description'}</th>
                      <th className="pb-2 font-medium text-end">{isHe ? 'כמות' : 'Qty'}</th>
                      <th className="pb-2 font-medium text-end">{isHe ? 'מחיר' : 'Price'}</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'הון כלוא' : 'Capital Tied'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_dead_stock.map((item: any, i: number) => (
                      <tr key={item.item_code} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-2 ps-4 md:ps-0 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 font-mono text-xs">{item.item_code}</td>
                        <td className="py-2 truncate max-w-[200px]">{item.item_name}</td>
                        <td className="py-2 text-end tabular-nums">{NUMBER_FORMAT.format(item.qty)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{ILS_FORMAT.format(Math.round(item.retail_price))}</td>
                        <td className="py-2 text-end font-mono tabular-nums font-semibold text-destructive pe-4 md:pe-0">
                          {ILS_FORMAT.format(Math.round(item.capital_tied))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {data.top_dead_stock.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <td colSpan={5} className="py-2 ps-4 md:ps-0">{isHe ? 'סה"כ Top 50' : 'Total Top 50'}</td>
                        <td className="py-2 text-end font-mono tabular-nums text-destructive pe-4 md:pe-0">
                          {ILS_FORMAT.format(Math.round(data.top_dead_stock.reduce((s: number, i: any) => s + i.capital_tied, 0)))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
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
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Revenue Decline ── */}
      {section === 'revenue' && (
        <div className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'השוואה חודשית - 2023 vs 2024 vs 2025' : 'Monthly Comparison - 2023 vs 2024 vs 2025'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={monthlyCompare}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [ILS_FORMAT.format(value), '']} />
                  <Legend />
                  <Line type="monotone" dataKey="2023" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} animationDuration={800} />
                  <Line type="monotone" dataKey="2024" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} animationDuration={800} />
                  <Line type="monotone" dataKey="2025" stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} animationDuration={800} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Monthly comparison table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'השוואה חודשית 2025 vs 2024' : 'Monthly 2025 vs 2024'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">{isHe ? 'חודש' : 'Month'}</th>
                      <th className="pb-2 font-medium text-end">2024</th>
                      <th className="pb-2 font-medium text-end">2025</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'שינוי' : 'Change'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyCompare.map((m: any, i: number) => {
                      const change = m['2024'] > 0 ? Math.round((m['2025'] - m['2024']) / m['2024'] * 1000) / 10 : null
                      return (
                        <tr key={i} className="border-b hover:bg-muted/50 transition-colors">
                          <td className="py-2 ps-4 md:ps-0">{m.month}</td>
                          <td className="py-2 text-end font-mono tabular-nums">{m['2024'] > 0 ? ILS_FORMAT.format(m['2024']) : '—'}</td>
                          <td className="py-2 text-end font-mono tabular-nums">{m['2025'] > 0 ? ILS_FORMAT.format(m['2025']) : '—'}</td>
                          <td className="py-2 text-end pe-4 md:pe-0">
                            {change !== null && m['2025'] > 0 && (
                              <Badge variant={change > 0 ? 'success' : 'destructive'}>
                                {change > 0 ? '+' : ''}{change}%
                              </Badge>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
      {section === 'seasonal' && (
        <div className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'ממוצע הכנסות חודשי (רב-שנתי)' : 'Monthly Revenue Average (Multi-Year)'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={seasonalData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [ILS_FORMAT.format(value), isHe ? 'ממוצע' : 'Average']} />
                  <Bar dataKey="avg_revenue" radius={[4, 4, 0, 0]} animationDuration={800}>
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
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [ILS_FORMAT.format(value), isHe ? 'ממוצע' : 'Average']} />
                    <Bar dataKey="avg_revenue" fill="#a78bfa" radius={[4, 4, 0, 0]} animationDuration={800} />
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
      {section === 'credits' && (
        <div className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'מגמת זיכויים לאורך שנים' : 'Credit Notes Trend Over Years'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={creditChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: string) => [
                    `${value}%`,
                    name === 'credit_pct' ? (isHe ? '% כמות' : '% Count') : (isHe ? '% ערך' : '% Value')
                  ]} />
                  <Legend formatter={(v) => v === 'credit_pct' ? (isHe ? '% זיכויים (כמות)' : 'Credit % (Count)') : (isHe ? '% זיכויים (ערך)' : 'Credit % (Value)')} />
                  <Line type="monotone" dataKey="credit_pct" stroke="#f87171" strokeWidth={2} dot={{ r: 4 }} animationDuration={800} />
                  <Line type="monotone" dataKey="credit_value_pct" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} animationDuration={800} />
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
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">{isHe ? 'שנה' : 'Year'}</th>
                      <th className="pb-2 font-medium text-end">{isHe ? 'חשבוניות' : 'Invoices'}</th>
                      <th className="pb-2 font-medium text-end">{isHe ? 'זיכויים' : 'Credits'}</th>
                      <th className="pb-2 font-medium text-end">{isHe ? '% כמות' : '% Count'}</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? '% ערך' : '% Value'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.credits_by_year.map((r: any) => {
                      const countPct = r.invoice_count > 0 ? Math.round(r.credit_count / r.invoice_count * 1000) / 10 : 0
                      const valuePct = r.invoice_total > 0 ? Math.round(r.credit_total / r.invoice_total * 1000) / 10 : 0
                      return (
                        <tr key={r.year} className="border-b hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 ps-4 md:ps-0 font-medium">{r.year}</td>
                          <td className="py-2.5 text-end tabular-nums">{NUMBER_FORMAT.format(r.invoice_count)}</td>
                          <td className="py-2.5 text-end tabular-nums">{NUMBER_FORMAT.format(r.credit_count)}</td>
                          <td className="py-2.5 text-end">
                            <Badge variant={countPct > 18 ? 'destructive' : countPct > 15 ? 'warning' : 'success'}>{countPct}%</Badge>
                          </td>
                          <td className="py-2.5 text-end pe-4 md:pe-0">
                            <Badge variant={valuePct > 12 ? 'destructive' : valuePct > 10 ? 'warning' : 'success'}>{valuePct}%</Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
      {section === 'customers' && (
        <div className="space-y-4 md:space-y-6">
          {/* Retention chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isHe ? 'שימור לקוחות לאורך שנים' : 'Customer Retention Over Years'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={retentionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend formatter={(v) => {
                    if (v === 'returning_customers') return isHe ? 'לקוחות חוזרים' : 'Returning'
                    if (v === 'new_customers') return isHe ? 'לקוחות חדשים' : 'New'
                    return v
                  }} />
                  <Bar dataKey="returning_customers" stackId="a" fill="#60a5fa" animationDuration={800} />
                  <Bar dataKey="new_customers" stackId="a" fill="#34d399" radius={[4, 4, 0, 0]} animationDuration={800} />
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
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">{isHe ? 'שנה' : 'Year'}</th>
                      <th className="pb-2 font-medium text-end">{isHe ? 'לקוחות' : 'Customers'}</th>
                      <th className="pb-2 font-medium text-end">{t('newCustomers')}</th>
                      <th className="pb-2 font-medium text-end">{t('returningCustomers')}</th>
                      <th className="pb-2 font-medium text-end">{t('retentionRate')}</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'הכנסות' : 'Revenue'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentionData.map((r: any) => (
                      <tr key={r.year} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 ps-4 md:ps-0 font-medium">{r.year}</td>
                        <td className="py-2.5 text-end tabular-nums">{r.total_customers}</td>
                        <td className="py-2.5 text-end">
                          <Badge variant={r.new_customers >= 50 ? 'success' : r.new_customers >= 30 ? 'warning' : 'destructive'}>
                            {r.new_customers}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-end tabular-nums">{r.returning_customers}</td>
                        <td className="py-2.5 text-end">
                          {r.retention_pct !== null ? (
                            <Badge variant={r.retention_pct >= 80 ? 'success' : 'warning'}>{r.retention_pct}%</Badge>
                          ) : '—'}
                        </td>
                        <td className="py-2.5 text-end font-mono tabular-nums pe-4 md:pe-0">{ILS_FORMAT.format(Math.round(r.total_revenue))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0">{isHe ? 'שנה' : 'Year'}</th>
                      <th className="pb-2 font-medium text-end">Top 5 %</th>
                      <th className="pb-2 font-medium text-end">Top 10 %</th>
                      <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'סה"כ לקוחות' : 'Total Customers'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customer_concentration.map((r: any) => (
                      <tr key={r.year} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 ps-4 md:ps-0 font-medium">{r.year}</td>
                        <td className="py-2.5 text-end">
                          <Badge variant={r.top5_pct >= 70 ? 'destructive' : r.top5_pct >= 50 ? 'warning' : 'success'}>{r.top5_pct}%</Badge>
                        </td>
                        <td className="py-2.5 text-end">
                          <Badge variant={r.top10_pct >= 80 ? 'destructive' : r.top10_pct >= 60 ? 'warning' : 'success'}>{r.top10_pct}%</Badge>
                        </td>
                        <td className="py-2.5 text-end tabular-nums pe-4 md:pe-0">{r.total_customers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
      {section === 'recommendations' && (
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
                        <td className="py-2.5 ps-4 md:ps-0 font-bold text-destructive">{i + 1}</td>
                        <td className="py-2.5">{r.action}</td>
                        <td className="py-2.5 text-end font-semibold pe-4 md:pe-0">{r.impact}</td>
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
                        <td className="py-2.5 ps-4 md:ps-0 font-bold text-amber-500">{i + 5}</td>
                        <td className="py-2.5">{r.action}</td>
                        <td className="py-2.5 text-end font-semibold pe-4 md:pe-0">{r.impact}</td>
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
                        current: `~${ILS_FORMAT.format(Math.round(kpis.monthly_revenue))}`,
                        target: '1.5M+',
                        met: kpis.monthly_revenue >= 1500000,
                      },
                      {
                        kpi: isHe ? 'מחזור מלאי שנתי' : 'Annual Inventory Turnover',
                        current: kpis.turnover_ratio.toFixed(2),
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

export default function ReportPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ReportContent />
    </Suspense>
  )
}
