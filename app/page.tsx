'use client'

import { useState, useMemo, useEffect, useRef, Suspense } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboard, useItems } from '@/hooks/use-dashboard'
import { useSalesAnalytics, useTopSellingItems, useSalesRange, useDemandAnalysis } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { KPIGrid } from '@/components/dashboard/KPIGrid'
import { ComparisonChart } from '@/components/charts/ComparisonChart'
import { DemandBarChart } from '@/components/charts/DemandBarChart'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ILS_FORMAT } from '@/lib/constants'
import type { Period, SalesDataPoint, TopSellingItem } from '@/lib/types'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ZAxis,
} from 'recharts'

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
  const { t } = useLocale()
  const { get, setMany } = useUrlParams()
  const queryClient = useQueryClient()
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]

  // ── Sales section state ──
  const urlDateFrom = get('date_from')
  const urlDateTo = get('date_to')
  const urlPeriod = get('period') as Period | null

  const [period, setPeriod] = useState<Period>(urlPeriod || '90d')
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

  useEffect(() => { backfillTriggeredRef.current = false }, [period])
  useEffect(() => {
    if (!needsBackfill || backfillTriggeredRef.current || isLoading) return
    backfillTriggeredRef.current = true
    setIsBackfilling(true)
    fetch('/api/sync?mode=backfill-docs')
      .then(() => queryClient.invalidateQueries({ queryKey: ['sales-range'] }))
      .catch(() => {})
      .finally(() => setIsBackfilling(false))
  }, [needsBackfill, isLoading])

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
    <div className="space-y-6">

      {/* ── KPIs ── */}
      <KPIGrid data={dashboard} isLoading={dashLoading} />

      {/* ── Sales controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
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
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">{t('total')}: </span>
            <span className="font-semibold">{totalRevenue.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('avgDay')}: </span>
            <span className="font-semibold">{avgDaily.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('transactions')}: </span>
            <span className="font-semibold">{totalTransactions.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {needsBackfill && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          <span className="shrink-0">{isBackfilling ? '⏳' : 'ℹ️'}</span>
          <span>{isBackfilling ? 'טוען נתונים היסטוריים לתקופה קודמת — ההשוואה תופיע בטעינה הבאה' : 'חסרים נתונים היסטוריים לתקופה קודמת. ניסיון לטעון אוטומטית...'}</span>
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
          {(isLoading || topLoading) ? (
            <Skeleton className="w-full h-[200px]" />
          ) : topItems.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">{t('topItemsPlaceholder')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-start py-2 pe-4">#</th>
                    <th className="text-start py-2 pe-4">{t('code')}</th>
                    <th className="text-start py-2 pe-4">{t('item')}</th>
                    <th className="text-end py-2 pe-4">{t('quantity')}</th>
                    <th className="text-end py-2 pe-4">{t('revenue')}</th>
                    <th className="text-end py-2 pe-4">{t('price')}</th>
                    <th className="text-end py-2">{t('stockQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topItems.map((item, idx) => (
                    <tr key={`${item.code}-${idx}`} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 pe-4 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2 pe-4 font-mono text-xs">{item.code}</td>
                      <td className="py-2 pe-4">{item.name}</td>
                      <td className="py-2 pe-4 text-end">{item.total_qty_sold.toLocaleString()}</td>
                      <td className="py-2 pe-4 text-end font-medium">{ILS_FORMAT.format(item.total_revenue)}</td>
                      <td className="py-2 pe-4 text-end">{ILS_FORMAT.format(item.avg_price)}</td>
                      <td className="py-2 text-end">
                        <span className={item.stock_qty <= 0 ? 'text-destructive font-medium' : ''}>
                          {item.stock_qty.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Demand section divider ── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 border-t border-border" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">ניתוח ביקוש</span>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* ── Demand controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
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
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
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
                  contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
                  formatter={(value: any, name: any) => [value, name]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload
                    if (!p) return ''
                    const parts = [`${p.name} (${p.code})`]
                    if (p.sale_date) parts.push(`Last sale: ${p.sale_date.substring(0, 10)}`)
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

    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <HomePageContent />
    </Suspense>
  )
}
