'use client'

import { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboard, useItems } from '@/hooks/use-dashboard'
import { useSalesAnalytics, useTopSellingItems, useSalesRange, useDemandAnalysis, useCrossPlatformKpis } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { ItemLink } from '@/components/shared/ItemLink'
import { KPIGrid } from '@/components/dashboard/KPIGrid'
import { MorningBrief } from '@/components/dashboard/MorningBrief'
import { ComparisonChart } from '@/components/charts/ComparisonChart'
import { DemandBarChart } from '@/components/charts/DemandBarChart'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { OverviewPageSkeleton } from '@/components/layout/PageSkeleton'
import type { Period, SalesDataPoint, TopSellingItem } from '@/lib/types'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, ZAxis,
} from 'recharts'
import { ChartGrid } from '@/components/charts/kit'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { PageHeader } from '@/components/shared/PageHeader'
import { LayoutDashboard } from 'lucide-react'

function getPreviousPeriodRange(period: Period): { dateFrom: string; dateTo: string } {
  const now = new Date()
  switch (period) {
    case '7d': return {
      dateFrom: new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0],
      dateTo: new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0],
    }
    case '30d': return {
      dateFrom: new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0],
      dateTo: new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0],
    }
    case '90d': return {
      dateFrom: new Date(now.getTime() - 180 * 86400000).toISOString().split('T')[0],
      dateTo: new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0],
    }
    case 'ytd': {
      const prevYear = now.getFullYear() - 1
      return {
        dateFrom: `${prevYear}-01-01`,
        dateTo: `${prevYear}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      }
    }
    case '1y': return {
      dateFrom: new Date(now.getTime() - 730 * 86400000).toISOString().split('T')[0],
      dateTo: new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0],
    }
    default: return getPreviousPeriodRange('30d')
  }
}

function shiftDateToCurrent(dateStr: string, period: Period): string {
  const d = new Date(dateStr + 'T00:00:00')
  switch (period) {
    case '7d': d.setDate(d.getDate() + 7); break
    case '30d': d.setDate(d.getDate() + 30); break
    case '90d': d.setDate(d.getDate() + 90); break
    case 'ytd':
    case '1y': d.setFullYear(d.getFullYear() + 1); break
  }
  return d.toISOString().split('T')[0]
}

/** Return the Sunday starting the ISO week that contains dateStr (Sunday = day 0 in JS) */
function getWeekSunday(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay())
  return d
}

/** Days to shift previous-period dates so their week-start Sunday aligns with current period's week-start Sunday */
function sundayAlignOffset(currentFrom: string, prevFrom: string): number {
  const ms = getWeekSunday(currentFrom).getTime() - getWeekSunday(prevFrom).getTime()
  return Math.round(ms / 86400000)
}

function HomePageContent() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t, locale } = useLocale()
  const isHe = locale === 'he'
  const { get, setMany } = useUrlParams()
  const queryClient = useQueryClient()
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]

  // ── Sales section state ──
  const urlDateFrom = get('date_from')
  const urlDateTo = get('date_to')
  const urlPeriod = get('period') as Period | null

  const [period, setPeriod] = useState<Period>(urlPeriod || '30d')
  const [customDateFrom, setCustomDateFrom] = useState<string | null>(urlDateFrom)
  const [customDateTo, setCustomDateTo] = useState<string | null>(urlDateTo)
  const [customMode, setCustomMode] = useState<boolean>(urlDateFrom !== null && urlDateTo !== null)

  const useCustomRange = customMode && customDateFrom !== null && customDateTo !== null
  const now = new Date()

  const effectiveDateFrom = useCustomRange ? customDateFrom! : (() => {
    switch (period) {
      case '7d': return new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]
      case '30d': return new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]
      case '90d': return new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]
      case 'ytd': return `${now.getFullYear()}-01-01`
      case '1y': return new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0]
      default: return new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]
    }
  })()
  const effectiveDateTo = useCustomRange ? customDateTo! : now.toISOString().split('T')[0]

  const periodResult = useSalesAnalytics(period, !useCustomRange)
  const rangeResult = useSalesRange(customDateFrom || '', customDateTo || '', useCustomRange)
  const { data, isLoading } = useCustomRange ? rangeResult : periodResult
  const { data: topData, isLoading: topLoading } = useTopSellingItems(useCustomRange ? '90d' : period)

  useEffect(() => {
    if (useCustomRange) {
      setMany({ date_from: customDateFrom, date_to: customDateTo, period: null })
    } else {
      setMany({ period, date_from: null, date_to: null })
    }
  }, [period, customDateFrom, customDateTo, useCustomRange, customMode, setMany])

  const prevRange = useMemo(() => getPreviousPeriodRange(period), [period])
  const { data: prevData } = useSalesRange(prevRange.dateFrom, prevRange.dateTo, !useCustomRange)

  const salesData: SalesDataPoint[] = data?.data || []
  const prevSalesData: SalesDataPoint[] = useCustomRange ? [] : (prevData?.data || [])
  const topItems: TopSellingItem[] = topData?.data || []
  const totalRevenue = salesData.reduce((sum, d) => sum + d.revenue, 0)
  const avgDaily = salesData.length > 0 ? totalRevenue / salesData.length : 0
  const totalTransactions = salesData.reduce((sum, d) => sum + d.count, 0)

  const [isBackfilling, setIsBackfilling] = useState(false)
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const backfillTriggeredRef = useRef(false)
  const [alignByWeekday, setAlignByWeekday] = useState(false)

  const comparisonData = useMemo(() => {
    if (useCustomRange) {
      return salesData.filter(d => d.revenue > 0).map(d => ({ date: d.date, current: d.revenue, previous: 0, previousDate: '' }))
    }
    if (!prevSalesData.length) return []
    const prevByShiftedDate = new Map<string, { revenue: number; originalDate: string }>()

    if (alignByWeekday) {
      // Align previous period's week-start Sunday to match current period's week-start Sunday
      const offsetDays = sundayAlignOffset(effectiveDateFrom, prevRange.dateFrom)
      for (const p of prevSalesData) {
        const d = new Date(p.date + 'T00:00:00')
        d.setDate(d.getDate() + offsetDays)
        prevByShiftedDate.set(d.toISOString().split('T')[0], { revenue: p.revenue, originalDate: p.date })
      }
    } else {
      for (const p of prevSalesData) {
        prevByShiftedDate.set(shiftDateToCurrent(p.date, period), { revenue: p.revenue, originalDate: p.date })
      }
    }

    return salesData.map(d => {
      const prev = prevByShiftedDate.get(d.date)
      return { date: d.date, current: d.revenue, previous: prev?.revenue || 0, previousDate: prev?.originalDate || '' }
    }).filter(d => d.current > 0 || d.previous > 0)
  }, [salesData, prevSalesData, period, useCustomRange, alignByWeekday, effectiveDateFrom, prevRange.dateFrom])

  const prevCoverage = useMemo(() => {
    if (!comparisonData.length) return 1
    return comparisonData.filter(d => d.previous > 0).length / comparisonData.length
  }, [comparisonData])

  const needsBackfill = !useCustomRange && (period === '1y' || period === 'ytd') && prevCoverage < 0.5 && salesData.length > 30

  // Backfilling is something you ask for, not something that happens because
  // you looked at a chart. This used to fire from an effect the moment previous
  // -period coverage dipped under 50%: once per tab, so two windows meant two
  // concurrent document syncs, with `.catch(() => {})` swallowing whatever came
  // back. Loading a page should not start an ETL job.
  useEffect(() => { backfillTriggeredRef.current = false }, [period])

  const runBackfill = useCallback(() => {
    if (backfillTriggeredRef.current) return
    backfillTriggeredRef.current = true
    setIsBackfilling(true)
    setBackfillError(null)
    fetch('/api/sync?mode=backfill-docs')
      .then(res => {
        if (!res.ok) throw new Error(String(res.status))
        return queryClient.invalidateQueries({ queryKey: ['sales-range'] })
      })
      .catch(() => {
        // Say so. The silent catch here is why a failed backfill looked
        // identical to one that had simply not finished yet.
        setBackfillError(isHe ? 'הטעינה נכשלה' : 'Backfill failed')
        backfillTriggeredRef.current = false
      })
      .finally(() => setIsBackfilling(false))
  }, [queryClient, isHe])

  // ── Demand section state ──
  const [demandMode, setDemandMode] = useState<'count' | 'qty'>((get('dmode') as 'count' | 'qty') || 'count')
  const [demandDateFrom, setDemandDateFrom] = useState(get('dfrom') || `${currentYear - 1}-01-01`)
  const [demandDateTo, setDemandDateTo] = useState(get('dto') || today)
  const [hoveredCode, setHoveredCode] = useState<string | null>(null)

  const { data: dashboard, isLoading: dashLoading } = useDashboard()
  const { data: demandData, isLoading: demandLoading } = useDemandAnalysis(demandDateFrom, demandDateTo)
  const { data: itemsData } = useItems()

  useEffect(() => {
    setMany({ dmode: demandMode, dfrom: demandDateFrom, dto: demandDateTo })
  }, [demandMode, demandDateFrom, demandDateTo, setMany])

  const topItemColumns = useMemo(() => TOP_ITEM_COLUMNS(t), [t])

  const demandItems = demandData?.items || []
  const enrichedItems = itemsData?.items || []
  const stockMap = useMemo(() => new Map<string, any>(enrichedItems.map((i: any) => [i.code, i])), [enrichedItems])

  const scatterData = useMemo(() => demandItems
    .filter((item: any) => item.code.length > 1)
    .slice(0, 100)
    .map((item: any) => {
      const enriched = stockMap.get(item.code)
      const stockQty = enriched?.stock_qty ?? item.stock_qty ?? 0
      const daysSinceSale = item.days_since_sale
      let color = '#60a5fa'
      if (item.request_count > 1 && stockQty < 5) color = '#f87171'
      else if (daysSinceSale !== undefined && daysSinceSale < 30) color = '#34d399'
      else if (daysSinceSale !== undefined && daysSinceSale > 180) color = '#fb923c'
      return {
        x: demandMode === 'count' ? item.request_count : item.total_qty_requested,
        y: stockQty,
        name: item.name,
        code: item.code,
        color,
        sale_date: item.sale_date,
        days_since_sale: daysSinceSale,
      }
    })
    .filter((d: any) => d.x > 0),
  [demandItems, stockMap, demandMode])

  const yValues = useMemo(() => scatterData.map((d: any) => d.y).sort((a: number, b: number) => a - b), [scatterData])
  const p95Index = Math.floor(yValues.length * 0.95)
  const yMax = yValues[p95Index] || yValues[yValues.length - 1] || 100
  const filteredScatter = scatterData.filter((d: any) => d.y <= yMax * 1.2)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* The overview was the ninth screen with no heading element. The TopBar
          names the route but is deliberately not an h1 (see the comment there),
          so the app's front page had no document outline at all and nothing for
          a screen reader to land on above the KPI figures. */}
      <PageHeader title={t('overview')} icon={LayoutDashboard} />

      {/* ── Morning Brief ── */}
      <MorningBrief />

      {/* ── KPIs ── */}
      <KPIGrid data={dashboard} isLoading={dashLoading} dailySales={salesData} />

      {/* ── Sales controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <PeriodSelector
            value={period}
            onChange={(p) => { setPeriod(p); setCustomMode(false) }}
            isCustom={customMode}
            onCustom={() => {
              setCustomMode(true)
              if (!customDateFrom) setCustomDateFrom(effectiveDateFrom)
              if (!customDateTo) setCustomDateTo(effectiveDateTo)
            }}
          />
          {customMode && (
            <DateRangePicker
              dateFrom={customDateFrom || effectiveDateFrom}
              dateTo={customDateTo || effectiveDateTo}
              onChange={(from, to) => { setCustomDateFrom(from); setCustomDateTo(to) }}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-1 text-xs sm:text-sm">
          <div>
            <span className="text-muted-foreground">{t('total')}: </span>
            <span className="font-semibold">{formatCurrency(totalRevenue)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('avgDay')}: </span>
            <span className="font-semibold">{formatCurrency(avgDaily)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('transactions')}: </span>
            <span className="font-semibold">{totalTransactions.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {needsBackfill && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          <span className="shrink-0" aria-hidden>{isBackfilling ? '⏳' : 'ℹ️'}</span>
          <span className="min-w-0 flex-1">
            {isBackfilling
              ? (isHe
                  ? 'טוען נתונים היסטוריים — ההשוואה תופיע כשיסתיים'
                  : 'Loading history — the comparison appears when it finishes')
              : (backfillError
                  ? backfillError
                  : (isHe
                      ? 'חסרים נתונים היסטוריים לתקופה הקודמת, ולכן ההשוואה חלקית.'
                      : 'History for the previous period is incomplete, so the comparison is partial.'))}
          </span>
          {!isBackfilling && (
            <button
              type="button"
              onClick={runBackfill}
              className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {backfillError
                ? (isHe ? 'נסה שוב' : 'Retry')
                : (isHe ? 'טען נתונים היסטוריים' : 'Load history')}
            </button>
          )}
        </div>
      )}

      <ComparisonChart
        data={comparisonData}
        title={t('periodComparison')}
        isLoading={isLoading}
        headerActions={!useCustomRange ? (
          <button
            onClick={() => setAlignByWeekday(a => !a)}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
              alignByWeekday
                ? 'bg-primary text-primary-foreground border-primary'
                : 'text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground'
            }`}
          >
            יישור לפי יום ראשון
          </button>
        ) : undefined}
      />

      {/* ── Top Selling Items ── */}
      <Card>
        <CardHeader><CardTitle>{t('topSellingItems')}</CardTitle></CardHeader>
        <CardContent>
          {/* DataTable owns loading/empty, so this no longer needs a ternary
              per state — the skeleton keeps the column layout instead of
              collapsing to one grey block. */}
          <DataTable
            rows={topItems}
            columns={topItemColumns}
            getRowKey={(item, idx) => `${item.code}-${idx}`}
            loading={isLoading || topLoading}
            defaultSort={{ field: 'total_revenue', dir: 'desc' }}
            minWidth="min-w-[600px]"
            labels={{ empty: t('topItemsPlaceholder') }}
          />
        </CardContent>
      </Card>

      {/* ── Demand section divider ── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 border-t border-border" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">ניתוח ביקוש</span>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* ── Demand controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        <Tabs value={demandMode} onValueChange={(v) => setDemandMode(v as 'count' | 'qty')}>
          <TabsList>
            <TabsTrigger value="count">{t('byRequests')}</TabsTrigger>
            <TabsTrigger value="qty">{t('byQuantity')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <DateRangePicker
          dateFrom={demandDateFrom}
          dateTo={demandDateTo}
          onChange={(from, to) => { setDemandDateFrom(from); setDemandDateTo(to) }}
        />
      </div>

      <DemandBarChart
        data={demandItems}
        isLoading={demandLoading}
        mode={demandMode}
        limit={10}
        hoveredCode={hoveredCode}
        onHover={setHoveredCode}
      />

      {/* ── Demand vs Stock scatter ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('demandVsStock')}</CardTitle>
          <CardDescription>{t('highDemandLowStock')}</CardDescription>
        </CardHeader>
        <CardContent>
          {demandLoading ? (
            <Skeleton className="w-full h-[400px]" />
          ) : filteredScatter.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] sm:h-[280px] lg:h-[350px] text-muted-foreground text-sm">
              {t('noInsights')}
            </div>
          ) : (
            <div className="h-[250px] sm:h-[320px] lg:h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 20 }}>
                <ChartGrid />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={demandMode === 'count' ? t('requestCount') : t('qtyRequested')}
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                  label={{ value: demandMode === 'count' ? t('requestCount') : t('qtyRequested'), position: 'bottom', fontSize: 12, fill: 'var(--muted-foreground)', offset: 15 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={t('stockQty')}
                  domain={[0, Math.ceil(yMax * 1.2)]}
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                  label={{ value: t('stockQty'), angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }}
                />
                <ZAxis range={[60, 300]} />
                <Tooltip
                  formatter={(value: any, name: any) => [value, name]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload
                    if (!p) return ''
                    const parts = [`${p.name} (${p.code})`]
                    if (p.sale_date) parts.push(`Last sale: ${formatDate(p.sale_date)}`)
                    return parts.join('\n')
                  }}
                  labelStyle={{ color: 'var(--popover-foreground)', fontWeight: 'bold' }}
                  itemStyle={{ color: 'var(--popover-foreground)' }}
                />
                <Scatter data={filteredScatter} onMouseLeave={() => setHoveredCode(null)}>
                  {filteredScatter.map((entry: any, index: number) => {
                    const isHighlighted = entry.code === hoveredCode
                    const isDimmed = hoveredCode && !isHighlighted
                    return (
                      <Cell
                        key={index}
                        fill={entry.color}
                        fillOpacity={isDimmed ? 0.4 : isHighlighted ? 1 : 0.8}
                        stroke={isHighlighted ? 'var(--foreground)' : 'none'}
                        strokeWidth={isHighlighted ? 2 : 0}
                        onMouseEnter={() => setHoveredCode(entry.code)}
                        onMouseLeave={() => setHoveredCode(null)}
                        style={{ cursor: 'pointer' }}
                      />
                    )
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cross-Platform KPIs */}
      <CrossPlatformKPIs />

    </div>
  )
}

function CrossPlatformKPIs() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const { data } = useCrossPlatformKpis()
  if (!data) return null

  const chat = data.chat || {}
  const ebay = data.ebay || {}
  const market = data.market || {}

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('overview')} — Platforms</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {/* Chat */}
          <a href="/chat-insights" className="p-3 rounded-lg bg-blue-500/5 hover:bg-blue-500/10 transition-colors">
            <div className="text-xs text-muted-foreground mb-1">AutoMate Chat</div>
            <div className="text-base sm:text-lg font-bold">{chat.conversations_today || 0} <span className="text-xs font-normal text-muted-foreground">today</span></div>
            <div className="text-xs text-muted-foreground">
              {chat.satisfaction_rate || 0}% satisfaction · {chat.zero_result_rate || 0}% zero results
            </div>
          </a>
          {/* eBay */}
          <a href="/ebay" className="p-3 rounded-lg bg-green-500/5 hover:bg-green-500/10 transition-colors">
            <div className="text-xs text-muted-foreground mb-1">eBay Channel</div>
            <div className="text-base sm:text-lg font-bold">{ebay.active_listings || 0} <span className="text-xs font-normal text-muted-foreground">listings</span></div>
            <div className="text-xs text-muted-foreground">
              {ebay.pending_recommendations || 0} pending · {ebay.stock_alerts || 0} alerts
            </div>
          </a>
          {/* Market */}
          <a href="/market" className="p-3 rounded-lg bg-violet-500/5 hover:bg-violet-500/10 transition-colors">
            <div className="text-xs text-muted-foreground mb-1">Vehicle Market</div>
            <div className="text-base sm:text-lg font-bold">{(market.total_vehicles || 0).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">vehicles</span></div>
            <div className="text-xs text-muted-foreground">Israel registrations (ICS)</div>
          </a>
        </div>
      </CardContent>
    </Card>
  )
}

/** Top-selling items, sorted client-side by whichever column you click. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const TOP_ITEM_COLUMNS = (t: (k: any) => string): DataTableColumn<any>[] => [
  {
    key: 'rank',
    header: '#',
    cellClassName: 'text-muted-foreground',
    // Rank follows the CURRENT sort, so it renumbers when you re-sort rather
    // than carrying a stale position from the original order.
    cell: (_row: any, idx: number) => idx + 1,
  },
  {
    key: 'code',
    header: t('code'),
    sortable: true,
    cellClassName: 'font-mono text-xs',
    cell: (item: any) => <ItemLink code={item.code} showCode />,
  },
  {
    key: 'name',
    header: t('item'),
    sortable: true,
    truncate: 'max-w-[260px]',
    title: (item: any) => item.name,
    cell: (item: any) => <ItemLink code={item.code} name={item.name} />,
  },
  { key: 'total_qty_sold', header: t('quantity'), align: 'end', sortable: true, cell: (i: any) => formatNumber(i.total_qty_sold) },
  { key: 'total_revenue', header: t('revenue'), align: 'end', sortable: true, cellClassName: 'font-medium', cell: (i: any) => formatCurrency(i.total_revenue) },
  { key: 'avg_price', header: t('price'), align: 'end', sortable: true, cell: (i: any) => formatCurrency(i.avg_price) },
  {
    key: 'stock_qty',
    header: t('stockQty'),
    align: 'end',
    sortable: true,
    cell: (i: any) => (
      <span className={i.stock_qty <= 0 ? 'text-destructive font-medium' : ''}>{formatNumber(i.stock_qty)}</span>
    ),
  },
]
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function HomePage() {
  return (
    <Suspense fallback={<OverviewPageSkeleton />}>
      <HomePageContent />
    </Suspense>
  )
}
