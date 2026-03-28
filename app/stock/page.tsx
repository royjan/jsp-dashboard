'use client'

import type React from 'react'
import { useState, useMemo, useEffect, useRef, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDeadStock, useABCClassification, useReorderRecommendations, useConversionAnalysis } from '@/hooks/use-analytics'
import { useItems } from '@/hooks/use-dashboard'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { DeadStockTreemap } from '@/components/charts/DeadStockTreemap'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip as UITooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ArrowUpDown, Search, Crown, TrendingUp, Layers, AlertTriangle, Sparkles, RefreshCw, TableIcon, LayoutGrid, ChevronDown, ChevronLeft, ChevronRight, Filter, Target, FileText, TrendingDown, Clock, ArrowRightLeft } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts'
import { ILS_FORMAT } from '@/lib/constants'
import { incrementStreaming, decrementStreaming } from '@/lib/streaming-counter'

// ── Types ──

const PAGE_SIZE = 10

type CardTab = 'analysis' | 'conversion'
type ConvTab = 'items' | 'customers'
type ItemSortField = 'name' | 'timesQuoted' | 'timesSold' | 'lostValue' | 'lastQuoted'
type ConvCustSortField = 'name' | 'quotesCount' | 'convertedCount' | 'rate' | 'lostValue'
type QuickView = 'all' | 'at_risk' | 'urgent' | 'dead' | 'excess'
type ABCFilter = 'all' | 'A' | 'B' | 'C'
type TierFilter = 'all' | HealthTier
type UnitSortField = 'name' | 'stock_qty' | 'price' | 'capital_tied' | 'revenue_pct' | 'health_score' | 'days_of_supply' | 'sold_this_year' | 'sold_last_year' | 'inquiry_count' | 'urgency_score' | 'recommended_qty' | 'days_since_sale'
type SortDir = 'asc' | 'desc'
type HealthTier = 'critical' | 'warning' | 'ok' | 'excess'

interface UnifiedItem {
  code: string
  name: string
  alias_codes?: string[]
  chain_history?: string[]
  stock_qty: number
  incoming_qty: number
  ordered_qty: number
  price: number
  capital_tied: number
  abc_class?: 'A' | 'B' | 'C'
  revenue_pct?: number
  revenue?: number
  health_tier: HealthTier
  health_score: number
  days_of_supply: number | null
  reorder_point: number
  suggested_order: number | null
  sold_this_year: number
  sold_last_year: number
  inquiry_count: number
  urgency_score: number
  recommended_qty: number
  sale_date?: string
  days_since_sale?: number
  is_dead: boolean
  is_at_risk: boolean
}

// ── Health Score ──

const LEAD_TIME_DAYS = 14

function computeHealthScore(item: any): { score: number; tier: HealthTier } {
  const sold = item.sold_this_year || 0
  const soldLy = item.sold_last_year || 0
  const inq = item.inquiry_count || 0
  const stock = item.stock_qty || 0
  const incoming = item.incoming_qty || 0
  const ordered = item.ordered_qty || 0
  // Full supply pipeline: on-hand + arriving + on-order
  const effectiveStock = stock + incoming + ordered
  const dailyDemand = (sold + soldLy * 0.5) / 365
  const reorderPoint = Math.ceil(dailyDemand * LEAD_TIME_DAYS)
  const monthlyDemand = (sold + soldLy * 0.5) / 12
  const dos = monthlyDemand > 0 ? (effectiveStock / monthlyDemand) * 30 : null
  if (sold === 0 && soldLy === 0 && inq === 0) return { score: 5, tier: 'excess' }
  if (reorderPoint > 0 && effectiveStock <= reorderPoint) return { score: 20, tier: 'critical' }
  if (dos !== null && dos < 30) return { score: 30, tier: 'warning' }
  if (dos !== null && dos >= 30 && dos <= 180) return { score: 85, tier: 'ok' }
  if (dos !== null && dos > 180) {
    const excessScore = Math.max(40, 85 - Math.min(45, Math.floor((dos - 180) / 30) * 5))
    return { score: excessScore, tier: 'excess' }
  }
  return { score: 70, tier: 'ok' }
}

// ── computeUnifiedItems ──

function computeUnifiedItems(allItems: any[], abcData: any, reorderData: any): UnifiedItem[] {
  const abcMap = new Map<string, any>()
  for (const item of (abcData?.items || [])) {
    if (item.code) abcMap.set(item.code, item)
  }
  const reorderMap = new Map<string, any>()
  for (const item of (reorderData?.items || [])) {
    if (item.code) reorderMap.set(item.code, item)
  }

  const results: UnifiedItem[] = []

  for (const i of allItems) {
    const sold = i.sold_this_year || 0
    const soldLy = i.sold_last_year || 0
    const inq = i.inquiry_count || 0
    const stock = i.stock_qty || 0
    const incoming = i.incoming_qty || 0
    const ordered = i.ordered_qty || 0
    const effectiveStock = stock + incoming + ordered

    if (effectiveStock === 0 && sold === 0 && inq === 0) continue

    const price = i.price || 0
    const capital_tied = stock * price  // only on-hand inventory counts as tied capital

    const abcItem = abcMap.get(i.code)
    const reorderItem = reorderMap.get(i.code)

    const abc_class = abcItem?.abc_class as 'A' | 'B' | 'C' | undefined
    const revenue_pct = abcItem?.revenue_pct
    const revenue = abcItem?.revenue

    const { score, tier } = computeHealthScore(i)

    const dailyDemand = (sold + soldLy * 0.5) / 365
    const monthlyDemand = (sold + soldLy * 0.5) / 12
    const reorder_point = Math.ceil(dailyDemand * LEAD_TIME_DAYS)

    let days_of_supply: number | null
    if (abcItem?.days_of_supply != null) {
      days_of_supply = abcItem.days_of_supply
    } else {
      days_of_supply = monthlyDemand > 0 ? Math.round((effectiveStock / monthlyDemand) * 30) : null
    }

    let suggested_order: number | null = null
    if (tier === 'critical' && monthlyDemand > 0) {
      // Deduct full supply pipeline from the suggested order
      suggested_order = Math.max(0, Math.min(500, Math.ceil(monthlyDemand * 2) - incoming - ordered))
    }

    const urgency_score = reorderItem?.urgency_score ?? 0
    const recommended_qty = reorderItem?.recommended_qty ?? 0

    let days_since_sale: number | undefined
    const sale_date = i.sale_date
    if (sale_date) {
      const d = new Date(sale_date)
      if (!isNaN(d.getTime())) {
        days_since_sale = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
      }
    }

    const is_dead = sold === 0 && soldLy === 0 && stock > 0
    const is_at_risk = abc_class === 'A' && ((days_of_supply !== null && days_of_supply < 30) || effectiveStock === 0)

    results.push({
      code: i.code,
      name: i.name,
      alias_codes: i.alias_codes,
      chain_history: i.chain_history,
      stock_qty: stock,
      incoming_qty: incoming,
      ordered_qty: ordered,
      price,
      capital_tied,
      abc_class,
      revenue_pct,
      revenue,
      health_tier: tier,
      health_score: score,
      days_of_supply,
      reorder_point,
      suggested_order,
      sold_this_year: sold,
      sold_last_year: soldLy,
      inquiry_count: Math.round(inq),
      urgency_score,
      recommended_qty,
      sale_date,
      days_since_sale,
      is_dead,
      is_at_risk,
    })
  }

  return results
}

// ── Helpers ──

function timeAgoHe(date: Date): string {
  const diff = Date.now() - date.getTime()
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(secs / 60)
  const hours = Math.floor(mins / 60)
  if (secs < 60) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  return `לפני ${hours} שע׳`
}

// ── ABCInsights ──

function ABCInsights({ data }: { data: any }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [triggered, setTriggered] = useState(false)
  const [tick, setTick] = useState(0)
  const isForceRef = useRef(false)
  const cancelRef = useRef<(() => void) | null>(null)

  // Build the same cache key the POST route uses, so we can look up the cache via GET
  const cacheKey = data.summary
    ? `ai:abc-insights:${data.summary.a_count}:${data.summary.b_count}:${data.summary.c_count}:${Math.round(data.summary.total_revenue / 100000)}`
    : null

  // On mount: auto-load from cache if available (no AI call needed)
  useEffect(() => {
    if (!cacheKey) return
    fetch(`/api/ai/abc-insights?key=${encodeURIComponent(cacheKey)}`)
      .then(r => r.ok ? r.json() : null)
      .then(cached => {
        if (!cached?.text) return
        setText(cached.text)
        setDone(true)
        setTriggered(true)
        setLastRefreshed(new Date(cached.ts))
      })
      .catch(() => {})
  }, [cacheKey])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const runInsights = (force: boolean) => {
    cancelRef.current?.()
    let cancelled = false
    cancelRef.current = () => { cancelled = true }

    const itemStockMap = new Map((data.items || []).map((i: any) => [i.code, i.stock_qty]))
    const aAtRiskEnriched = (data.a_items_at_risk || []).slice(0, 8).map((i: any) => ({
      code: i.code, name: i.name, stock: i.stock_qty, days: i.days_of_supply,
      revenue: Math.round(i.revenue),
      aliases_with_stock: (i.alias_codes || [])
        .map((ac: string) => ({ code: ac, stock: itemStockMap.get(ac) ?? 0 }))
        .filter((a: any) => a.stock > 0),
    }))

    async function run() {
      setLoading(true); setText(''); setDone(false)
      incrementStreaming()
      try {
        const res = await fetch('/api/ai/abc-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: data.summary, capital_by_class: data.capital_by_class,
            a_items_at_risk_enriched: aAtRiskEnriched,
            c_items_overstock: data.c_items_overstock, force,
          }),
        })
        const tsHeader = res.headers.get('X-Cache-Timestamp')
        if (tsHeader) setLastRefreshed(new Date(parseInt(tsHeader)))
        if (!res.ok || !res.body) return
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone || cancelled) break
          setText(prev => prev + decoder.decode(value, { stream: true }))
        }
        if (!cancelled) setDone(true)
      } catch {}
      finally {
        decrementStreaming()
        if (!cancelled) setLoading(false)
      }
    }
    run()
  }

  void tick

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          תובנות AI — סיווג ABC
          {triggered && (
            <div className="mr-auto flex items-center gap-3">
              {lastRefreshed && (
                <span className="text-xs text-muted-foreground font-normal">
                  {loading ? 'מחשב…' : timeAgoHe(lastRefreshed)}
                </span>
              )}
              <button
                onClick={() => { isForceRef.current = true; runInsights(true) }}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                <span className="hidden sm:inline">רענן</span>
              </button>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!triggered ? (
          <button
            onClick={() => { setTriggered(true); runInsights(false) }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            לחץ לניתוח AI
          </button>
        ) : loading && !text ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            מנתח נתונים…
          </div>
        ) : text ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 dir-rtl">
            {text}
            {!done && <span className="inline-block w-1 h-4 bg-primary ml-0.5 animate-pulse align-text-bottom" />}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ── ABCBadge ──

function ABCBadge({ cls }: { cls: string }) {
  if (cls === 'A') return <Badge variant="success" className="font-bold text-[10px]">A</Badge>
  if (cls === 'B') return <Badge variant="warning" className="font-bold text-[10px]">B</Badge>
  return <Badge variant="secondary" className="font-bold text-[10px]">C</Badge>
}

// ── Tier config ──

const tierConfig = {
  critical: { label: 'חסר!', variant: 'destructive' as const },
  warning:  { label: 'נמוך',  variant: 'warning' as const },
  ok:       { label: 'תקין',  variant: 'success' as const },
  excess:   { label: 'עודף',  variant: 'secondary' as const },
}

// ── Conversion section ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convCardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({ opacity: 1, y: 0, scale: 1, transition: { delay: i * 0.08, duration: 0.4 } }),
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convRowVariants: any = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({ opacity: 1, x: 0, transition: { delay: i * 0.025, duration: 0.3 } }),
}

function ConversionSection({ searchQuery }: { searchQuery: string }) {
  const { t } = useLocale()
  const { get, setMany } = useUrlParams()
  const today = new Date().toISOString().split('T')[0]
  const default90d = new Date(new Date().getTime() - 90 * 86400000).toISOString().split('T')[0]

  const [dateFrom, setDateFrom] = useState(get('conv_from') || default90d)
  const [dateTo, setDateTo] = useState(get('conv_to') || today)
  const [convTab, setConvTab] = useState<ConvTab>((get('ctab') as ConvTab) || 'items')
  const [itemSort, setItemSort] = useState<ItemSortField>((get('isort') as ItemSortField) || 'lostValue')
  const [itemDir, setItemDir] = useState<SortDir>((get('idir') as SortDir) || 'desc')
  const [ccSort, setCcSort] = useState<ConvCustSortField>((get('ccsort') as ConvCustSortField) || 'lostValue')
  const [ccDir, setCcDir] = useState<SortDir>((get('ccdir') as SortDir) || 'desc')

  const { data, isLoading } = useConversionAnalysis(dateFrom, dateTo)

  useEffect(() => {
    setMany({
      conv_from: dateFrom === default90d ? null : dateFrom,
      conv_to: dateTo === today ? null : dateTo,
      ctab: convTab === 'items' ? null : convTab,
      isort: itemSort === 'lostValue' ? null : itemSort,
      idir: itemDir === 'desc' ? null : itemDir,
      ccsort: ccSort === 'lostValue' ? null : ccSort,
      ccdir: ccDir === 'desc' ? null : ccDir,
    })
  }, [dateFrom, dateTo, convTab, itemSort, itemDir, ccSort, ccDir, setMany])

  const unconvertedItems = useMemo(() => {
    let items = data?.unconverted_items || []
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter((i: any) => i.name.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q))
    }
    return [...items].sort((a: any, b: any) => {
      const cmp = (itemSort === 'name' || itemSort === 'lastQuoted') ? (a[itemSort] || '').localeCompare(b[itemSort] || '') : (a[itemSort] as number) - (b[itemSort] as number)
      return itemDir === 'desc' ? -cmp : cmp
    })
  }, [data, searchQuery, itemSort, itemDir])

  const customerConversions = useMemo(() => {
    let custs = data?.customer_conversions || []
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      custs = custs.filter((c: any) => c.name.toLowerCase().includes(q))
    }
    return [...custs].sort((a: any, b: any) => {
      const cmp = ccSort === 'name' ? a.name.localeCompare(b.name) : (a[ccSort] as number) - (b[ccSort] as number)
      return ccDir === 'desc' ? -cmp : cmp
    })
  }, [data, searchQuery, ccSort, ccDir])

  const ItemSortHeader = ({ field, children, className }: { field: ItemSortField; children: React.ReactNode; className?: string }) => (
    <th className={cn('pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap', className)}
      onClick={() => { if (itemSort === field) setItemDir(d => d === 'asc' ? 'desc' : 'asc'); else { setItemSort(field); setItemDir('desc') } }}>
      <span className="inline-flex items-center gap-1">{children}<ArrowUpDown className={cn('h-3 w-3 shrink-0', itemSort === field ? 'text-foreground' : 'text-muted-foreground/50')} /></span>
    </th>
  )

  const CcSortHeader = ({ field, children, className }: { field: ConvCustSortField; children: React.ReactNode; className?: string }) => (
    <th className={cn('pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap', className)}
      onClick={() => { if (ccSort === field) setCcDir(d => d === 'asc' ? 'desc' : 'asc'); else { setCcSort(field); setCcDir('desc') } }}>
      <span className="inline-flex items-center gap-1">{children}<ArrowUpDown className={cn('h-3 w-3 shrink-0', ccSort === field ? 'text-foreground' : 'text-muted-foreground/50')} /></span>
    </th>
  )

  if (isLoading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>)}
      </div>
      <Skeleton className="w-full h-[300px]" />
    </div>
  )
  if (!data) return null

  const funnelData = [
    { name: t('quoted'), value: data.total_quoted, fill: '#60a5fa' },
    { name: t('converted'), value: data.total_converted, fill: '#34d399' },
    { name: t('lost'), value: data.lost_revenue, fill: '#f87171' },
  ]
  const pieData = data.total_quoted > 0 ? [
    { name: t('converted'), value: data.total_converted, fill: '#34d399' },
    { name: t('lost'), value: data.lost_revenue, fill: '#f87171' },
  ] : []

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex justify-end">
        <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to) }} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        {[
          { icon: Target, label: t('conversionRate'), value: data.conversion_rate, format: 'percent' as const, sub: `${data.converted_lines} / ${data.total_quote_lines}`, color: data.conversion_rate >= 50 ? 'text-emerald-500' : data.conversion_rate >= 25 ? 'text-amber-500' : 'text-destructive', progress: data.conversion_rate },
          { icon: FileText, label: t('totalQuoted'), value: data.total_quoted, format: 'currency' as const, sub: `${data.total_quotes} ${t('quotesCount').toLowerCase()}`, color: 'text-primary' },
          { icon: TrendingDown, label: t('lostRevenue'), value: data.lost_revenue, format: 'currency' as const, color: 'text-destructive' },
          { icon: Clock, label: t('avgDaysToConvert'), value: data.avg_days_to_convert, format: 'number' as const, color: 'text-primary' },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} custom={i} variants={convCardVariants} initial="hidden" animate="visible">
            <Card className="overflow-hidden h-full">
              <CardContent className="p-3 md:p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
                  <kpi.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{kpi.label}</span>
                </div>
                <div className={cn('text-xl md:text-2xl font-bold', kpi.color)}>
                  <AnimatedCounter value={kpi.value} format={kpi.format} />
                </div>
                {kpi.sub && <div className="text-[11px] md:text-xs text-muted-foreground mt-1">{kpi.sub}</div>}
                {'progress' in kpi && kpi.progress !== undefined && <Progress value={kpi.progress} className="h-1.5 mt-2" />}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('quoteFunnel')}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={70} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }} formatter={(value: any) => [ILS_FORMAT.format(value), '']} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} animationDuration={800} animationBegin={400}>
                  {funnelData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('conversionRate')}</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} animationDuration={800} animationBegin={600} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                    {pieData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }} formatter={(value: any) => [ILS_FORMAT.format(value as number), '']} />
                  <text x="50%" y="48%" textAnchor="middle" fill="var(--foreground)" fontSize={28}>{data.conversion_rate}%</text>
                  <text x="50%" y="60%" textAnchor="middle" fill="var(--muted-foreground)" fontSize={12}>{t('conversionRate')}</text>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-muted-foreground text-sm py-12">{t('noInsights')}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <Tabs value={convTab} onValueChange={(v) => setConvTab(v as ConvTab)}>
              <TabsList>
                <TabsTrigger value="items" className="gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('unconvertedItems')}</span>
                  <span className="sm:hidden">{t('items')}</span>
                </TabsTrigger>
                <TabsTrigger value="customers" className="gap-1.5">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('customerConversion')}</span>
                  <span className="sm:hidden">{t('customers')}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="text-xs text-muted-foreground">
              {convTab === 'items' ? unconvertedItems.length : customerConversions.length} {t('items')}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            {convTab === 'items' ? (
              <motion.div key="items" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }}>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto -mx-4 md:mx-0">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="sticky top-0 bg-background z-10">
                      <tr className="border-b">
                        <ItemSortHeader field="name" className="text-start ps-4 md:ps-0">{t('item')}</ItemSortHeader>
                        <ItemSortHeader field="timesQuoted" className="text-end">{t('timesQuoted')}</ItemSortHeader>
                        <ItemSortHeader field="timesSold" className="text-end">{t('timesSold')}</ItemSortHeader>
                        <ItemSortHeader field="lostValue" className="text-end">{t('lostRevenue')}</ItemSortHeader>
                        <ItemSortHeader field="lastQuoted" className="text-end pe-4 md:pe-0">{t('lastQuoted')}</ItemSortHeader>
                      </tr>
                    </thead>
                    <tbody>
                      {unconvertedItems.map((item: any, idx: number) => (
                        <motion.tr key={idx} custom={idx} variants={convRowVariants} initial="hidden" animate="visible" className="border-b hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 ps-4 md:ps-0">
                            <div className="font-medium truncate max-w-[200px] md:max-w-none">{item.name}</div>
                            {item.code && <div className="text-xs text-muted-foreground">{item.code}</div>}
                          </td>
                          <td className="py-2.5 text-end tabular-nums">{item.timesQuoted}</td>
                          <td className="py-2.5 text-end tabular-nums">{item.timesSold}</td>
                          <td className="py-2.5 text-end font-mono text-destructive">{ILS_FORMAT.format(item.lostValue)}</td>
                          <td className="py-2.5 text-end text-muted-foreground pe-4 md:pe-0">{item.lastQuoted?.substring(0, 10)}</td>
                        </motion.tr>
                      ))}
                      {unconvertedItems.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">{t('noInsights')}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            ) : (
              <motion.div key="customers" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto -mx-4 md:mx-0">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="sticky top-0 bg-background z-10">
                      <tr className="border-b">
                        <CcSortHeader field="name" className="text-start ps-4 md:ps-0">{t('customer')}</CcSortHeader>
                        <CcSortHeader field="quotesCount" className="text-end">{t('quotesCount')}</CcSortHeader>
                        <CcSortHeader field="convertedCount" className="text-end">{t('convertedCount')}</CcSortHeader>
                        <CcSortHeader field="rate" className="text-end">{t('rate')}</CcSortHeader>
                        <CcSortHeader field="lostValue" className="text-end pe-4 md:pe-0">{t('lostRevenue')}</CcSortHeader>
                      </tr>
                    </thead>
                    <tbody>
                      {customerConversions.map((cust: any, idx: number) => (
                        <motion.tr key={idx} custom={idx} variants={convRowVariants} initial="hidden" animate="visible" className="border-b hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 ps-4 md:ps-0">
                            <div className="font-medium truncate max-w-[200px] md:max-w-none">{cust.name}</div>
                          </td>
                          <td className="py-2.5 text-end tabular-nums">{cust.quotesCount}</td>
                          <td className="py-2.5 text-end tabular-nums">{cust.convertedCount}</td>
                          <td className="py-2.5 text-end">
                            <Badge variant={cust.rate >= 70 ? 'success' : cust.rate >= 40 ? 'warning' : 'destructive'}>{cust.rate}%</Badge>
                          </td>
                          <td className="py-2.5 text-end font-mono text-destructive pe-4 md:pe-0">{ILS_FORMAT.format(cust.lostValue)}</td>
                        </motion.tr>
                      ))}
                      {customerConversions.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">{t('noInsights')}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  )
}

// ── StockPageContent ──

function StockPageContent() {
  const { t } = useLocale()
  const { get, setMany } = useUrlParams()

  // Card tab state
  const [cardTab, setCardTab] = useState<CardTab>('analysis')

  // Dead stock treemap state
  const [yearsFilter, setYearsFilter] = useState(Number(get('years')) || 1)
  const [viewMode, setViewMode] = useState<'map' | 'table'>((get('view') as 'map' | 'table') || 'table')
  const [treemapPage, setTreemapPage] = useState(0)

  // Unified table state
  const [searchQuery, setSearchQuery] = useState(get('search') || '')
  const [quickView, setQuickView] = useState<QuickView>((get('qv') as QuickView) || 'all')
  const [abcFilter, setAbcFilter] = useState<ABCFilter>((get('abc') as ABCFilter) || 'all')
  const [tierFilter, setTierFilter] = useState<TierFilter>((get('tier') as TierFilter) || 'all')
  const [sortField, setSortField] = useState<UnitSortField>((get('sort') as UnitSortField) || 'capital_tied')
  const [sortDir, setSortDir] = useState<SortDir>((get('dir') as SortDir) || 'desc')
  const [page, setPage] = useState(0)
  const [abcDropdownOpen, setAbcDropdownOpen] = useState(false)
  const abcDropdownRef = useRef<HTMLDivElement>(null)
  const [tierDropdownOpen, setTierDropdownOpen] = useState(false)
  const tierDropdownRef = useRef<HTMLDivElement>(null)

  // Data
  const { data: deadData, isLoading: deadLoading } = useDeadStock(yearsFilter)
  const { data: itemsData, isLoading: itemsLoading } = useItems()
  const { data: abcData } = useABCClassification()
  const { data: reorderData } = useReorderRecommendations()

  // Reset page on filter change
  useEffect(() => { setPage(0) }, [searchQuery, quickView, abcFilter, tierFilter, sortField, sortDir])

  // Close ABC dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (abcDropdownRef.current && !abcDropdownRef.current.contains(e.target as Node)) {
        setAbcDropdownOpen(false)
      }
      if (tierDropdownRef.current && !tierDropdownRef.current.contains(e.target as Node)) {
        setTierDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Sync URL
  useEffect(() => {
    setMany({
      years: yearsFilter === 1 ? null : String(yearsFilter),
      view: viewMode === 'table' ? null : viewMode,
      search: searchQuery || null,
      qv: quickView === 'all' ? null : quickView,
      abc: abcFilter === 'all' ? null : abcFilter,
      tier: tierFilter === 'all' ? null : tierFilter,
      sort: sortField === 'capital_tied' ? null : sortField,
      dir: sortDir === 'desc' ? null : sortDir,
    })
  }, [yearsFilter, viewMode, searchQuery, quickView, abcFilter, tierFilter, sortField, sortDir, setMany])

  // Raw data
  const allItems: any[] = itemsData?.items || []
  const deadItems = deadData?.items || []
  const totalDeadCapital = deadData?.total_capital || 0

  // Stock health overview (based on items with stock)
  const itemsWithStock = allItems.filter((i: any) => i.stock_qty > 0)
  const totalStockItems = itemsWithStock.length
  const healthyItems = itemsWithStock.filter((i: any) => i.sold_this_year > 0 || i.sold_last_year > 0).length
  const slowMoving = itemsWithStock.filter((i: any) => i.sold_this_year === 0 && i.sold_last_year > 0).length
  const deadCount = itemsWithStock.filter((i: any) => i.sold_this_year === 0 && i.sold_last_year === 0).length

  // ABC data
  const abcSummary = abcData?.summary
  const abcCapital = abcData?.capital_by_class
  const totalAbcCapital = abcCapital?.total_capital || 1

  const barChartData = abcSummary ? [
    { name: 'A', revenue: abcSummary.a_revenue_pct, capital: Math.round((abcCapital.a_capital / totalAbcCapital) * 100) },
    { name: 'B', revenue: abcSummary.b_revenue_pct, capital: Math.round((abcCapital.b_capital / totalAbcCapital) * 100) },
    { name: 'C', revenue: abcSummary.c_revenue_pct, capital: Math.round((abcCapital.c_capital / totalAbcCapital) * 100) },
  ] : []

  const pieData = abcCapital ? [
    { name: 'A', value: abcCapital.a_capital, fill: '#34d399' },
    { name: 'B', value: abcCapital.b_capital, fill: '#60a5fa' },
    { name: 'C', value: abcCapital.c_capital, fill: '#94a3b8' },
  ].filter(d => d.value > 0) : []

  const abcKpis = abcSummary ? [
    { icon: Crown,         label: 'קלאס A',   count: abcSummary.a_count,              pct: abcSummary.a_revenue_pct, color: 'text-emerald-500', badge: 'success' as const },
    { icon: TrendingUp,    label: 'קלאס B',   count: abcSummary.b_count,              pct: abcSummary.b_revenue_pct, color: 'text-blue-500',    badge: 'default' as const },
    { icon: Layers,        label: 'קלאס C',   count: abcSummary.c_count,              pct: abcSummary.c_revenue_pct, color: 'text-slate-400',   badge: 'secondary' as const },
    { icon: AlertTriangle, label: 'A בסיכון', count: abcData?.a_items_at_risk?.length ?? 0, pct: abcSummary.a_count > 0 ? Math.round(((abcData?.a_items_at_risk?.length ?? 0) / abcSummary.a_count) * 100) : 0, color: 'text-amber-500', badge: 'warning' as const },
  ] : []

  // Unified items
  const unifiedItems = useMemo(
    () => computeUnifiedItems(allItems, abcData, reorderData),
    [allItems, abcData, reorderData]
  )

  // Alias resolution: when search returns 0 results, try to resolve via history API
  const [resolvedAlias, setResolvedAlias] = useState<{ queried: string; canonical: string; chain: string[] } | null>(null)
  const resolveRef = useRef<string | null>(null)

  useEffect(() => {
    // Reset resolved alias whenever search or filters change
    setResolvedAlias(null)
    resolveRef.current = null

    if (!searchQuery || unifiedItems.length === 0) return
    const trimmed = searchQuery.trim()
    const q = trimmed.toLowerCase()
    // directMatch only counts if the matching item would actually be visible with current filters
    const directMatch = unifiedItems.some(i => {
      if (!(i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || i.alias_codes?.some(c => c.toLowerCase().includes(q)))) return false
      if (quickView === 'at_risk' && !i.is_at_risk) return false
      if (quickView === 'urgent' && i.urgency_score <= 5) return false
      if (quickView === 'dead' && !i.is_dead) return false
      if (quickView === 'excess' && !(i.health_tier === 'excess' && !i.is_dead)) return false
      if (abcFilter !== 'all' && i.abc_class !== abcFilter) return false
      if (tierFilter !== 'all' && i.health_tier !== tierFilter) return false
      return true
    })
    if (directMatch) return
    resolveRef.current = trimmed
    let cancelled = false
    fetch(`/api/items/history?code=${encodeURIComponent(trimmed)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.canonical_code) return
        setResolvedAlias({ queried: trimmed, canonical: data.canonical_code, chain: data.item_id_history || [] })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [searchQuery, unifiedItems, quickView, abcFilter, tierFilter])

  // Quick view counts
  const qvCounts = useMemo(() => ({
    all:     unifiedItems.length,
    at_risk: unifiedItems.filter(i => i.is_at_risk).length,
    urgent:  unifiedItems.filter(i => i.urgency_score > 5).length,
    dead:    unifiedItems.filter(i => i.is_dead).length,
    excess:  unifiedItems.filter(i => i.health_tier === 'excess' && !i.is_dead).length,
  }), [unifiedItems])

  // Filtered + sorted unified items
  const filteredUnified = useMemo(() => {
    // Chain search: when we resolved an alias, bypass tier/abc/quickView filters
    // The user explicitly searched for a specific item — show it regardless of active filters
    if (resolvedAlias && resolvedAlias.queried === searchQuery) {
      const q = resolvedAlias.canonical.toLowerCase()
      const chainResult = unifiedItems.filter(i =>
        i.code.toLowerCase() === q ||
        i.alias_codes?.some(c => c.toLowerCase() === q)
      )
      if (chainResult.length > 0) return chainResult
    }

    let result = unifiedItems

    // quick view
    if (quickView === 'at_risk') result = result.filter(i => i.is_at_risk)
    else if (quickView === 'urgent') result = result.filter(i => i.urgency_score > 5)
    else if (quickView === 'dead') result = result.filter(i => i.is_dead)
    else if (quickView === 'excess') result = result.filter(i => i.health_tier === 'excess' && !i.is_dead)

    // abc filter
    if (abcFilter !== 'all') result = result.filter(i => i.abc_class === abcFilter)

    // tier filter
    if (tierFilter !== 'all') result = result.filter(i => i.health_tier === tierFilter)

    // search — if the raw query found nothing and we resolved an alias, search by canonical instead
    const effectiveSearch = (searchQuery && resolvedAlias?.queried === searchQuery)
      ? resolvedAlias.canonical
      : searchQuery
    if (effectiveSearch) {
      const q = effectiveSearch.toLowerCase()
      result = result.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.code.toLowerCase().includes(q) ||
        i.alias_codes?.some(c => c.toLowerCase().includes(q))
      )
    }

    // sort
    result = [...result].sort((a, b) => {
      let cmp: number
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortField === 'days_of_supply') {
        cmp = (a.days_of_supply ?? 99999) - (b.days_of_supply ?? 99999)
      } else if (sortField === 'days_since_sale') {
        cmp = (a.days_since_sale ?? 99999) - (b.days_since_sale ?? 99999)
      } else if (sortField === 'revenue_pct') {
        cmp = (a.revenue_pct ?? 0) - (b.revenue_pct ?? 0)
      } else {
        cmp = ((a as any)[sortField] as number) - ((b as any)[sortField] as number)
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return result
  }, [unifiedItems, quickView, abcFilter, tierFilter, searchQuery, resolvedAlias, sortField, sortDir])

  const handleSort = (field: UnitSortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortHeader = ({
    field,
    children,
    className,
  }: {
    field: UnitSortField
    children: React.ReactNode
    className?: string
  }) => (
    <th
      className={cn('pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap', className)}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className={cn('h-3 w-3 shrink-0', sortField === field ? 'text-foreground' : 'text-muted-foreground/50')} />
      </span>
    </th>
  )

  const quickViewPills: { key: QuickView; label: string }[] = [
    { key: 'all',     label: 'הכל' },
    { key: 'at_risk', label: 'A בסיכון' },
    { key: 'urgent',  label: 'הזמנה דחופה' },
    { key: 'dead',    label: 'מלאי מת' },
    { key: 'excess',  label: 'עודף' },
  ]

  return (
    <div className="space-y-6">

      {/* ── 2. Stock health cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-xl sm:text-2xl font-bold text-foreground">{totalStockItems}</p>
            <p className="text-xs text-muted-foreground">סה״כ פריטים במלאי</p>
            <Badge variant="outline" className="text-[10px]">עם מלאי</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-xl sm:text-2xl font-bold text-emerald-500">{healthyItems}</p>
            <p className="text-xs text-muted-foreground">{t('healthy')}</p>
            <Badge variant="success" className="text-[10px]">{t('soldYear')}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-xl sm:text-2xl font-bold text-amber-500">{slowMoving}</p>
            <p className="text-xs text-muted-foreground">תנועה איטית</p>
            <Badge variant="warning" className="text-[10px]">שנה שעברה בלבד</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-xl sm:text-2xl font-bold text-red-500">{deadCount}</p>
            <p className="text-xs text-muted-foreground">{t('deadStock')}</p>
            <Badge variant="destructive" className="text-[10px]">ללא מכירות 2+ שנים</Badge>
          </CardContent>
        </Card>
      </div>

      {/* ── 3. ABC KPI cards ── */}
      {abcSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
          {abcKpis.map((kpi) => (
            <Card key={kpi.label} className="overflow-hidden">
              <CardContent className="p-3 md:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <kpi.icon className={cn('h-4 w-4 shrink-0', kpi.color)} />
                  <span className="text-xs md:text-sm text-muted-foreground truncate">{kpi.label}</span>
                </div>
                <div className={cn('text-xl md:text-2xl font-bold', kpi.color)}>
                  <AnimatedCounter value={kpi.count} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {kpi.pct}% מההכנסות
                </div>
                <div className="h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700', {
                      'bg-emerald-500': kpi.badge === 'success',
                      'bg-blue-500': kpi.badge === 'default',
                      'bg-slate-400': kpi.badge === 'secondary',
                      'bg-amber-500': kpi.badge === 'warning',
                    })}
                    style={{ width: `${Math.min(kpi.pct, 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── 4. ABC Charts ── */}
      {abcSummary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">הכנסות vs. הון לפי קלאס</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barChartData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
                    formatter={(value: any, name: any) => [`${value}%`, name]}
                  />
                  <Legend />
                  <Bar dataKey="revenue" name="% הכנסות" fill="#34d399" radius={[4, 4, 0, 0]} animationDuration={800} />
                  <Bar dataKey="capital" name="% הון" fill="#60a5fa" radius={[4, 4, 0, 0]} animationDuration={800} animationBegin={200} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">הון כלוא לפי קלאס</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={45} outerRadius={80} paddingAngle={3} animationDuration={800}>
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
                    formatter={(value: any) => [ILS_FORMAT.format(value as number), '']}
                  />
                  <Legend />
                  <text x="50%" y="46%" textAnchor="middle" fill="var(--foreground)" fontSize={16} fontWeight="bold">
                    {ILS_FORMAT.format(abcCapital.total_capital)}
                  </text>
                  <text x="50%" y="56%" textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>
                    סה״כ הון כלוא
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── 5. AI Insights ── */}
      {abcData && <ABCInsights data={abcData} />}

      {/* ── 7. Unified table ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>ניתוח מלאי מאוחד</CardTitle>
              <CardDescription>כל הפריטים — מלאי, ABC, בריאות, הזמנה</CardDescription>
              <p className="text-xs text-muted-foreground mt-0.5">
                A = ~20% מהפריטים שמניבים ~70% מההכנסות · B = פריטים בינוניים (~20% הכנסות) · C = שאר הפריטים עם השפעה נמוכה על ההכנסות
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => setCardTab('analysis')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors border',
                  cardTab === 'analysis' ? 'bg-foreground text-background border-foreground' : 'bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground'
                )}
              >
                ניתוח מלאי
              </button>
              <button
                onClick={() => setCardTab('conversion')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors border',
                  cardTab === 'conversion' ? 'bg-foreground text-background border-foreground' : 'bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground'
                )}
              >
                המרות
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {cardTab === 'conversion' ? (
            <ConversionSection searchQuery={searchQuery} />
          ) : itemsLoading ? (
            <Skeleton className="w-full h-[400px]" />
          ) : (
            <>
              {/* Filter row */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                {/* Search */}
                <div className="relative min-w-[200px] flex-1 max-w-sm">
                  <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t('searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent ps-8 pe-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {/* Quick view pills */}
                <div className="flex flex-wrap gap-1.5">
                  {quickViewPills.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setQuickView(key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors border min-h-[36px]',
                        quickView === key
                          ? 'bg-foreground text-background border-foreground'
                          : 'bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground'
                      )}
                    >
                      {label}
                      <span className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                        quickView === key ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'
                      )}>
                        {qvCounts[key]}
                      </span>
                    </button>
                  ))}
                </div>

                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {filteredUnified.length} / {unifiedItems.length} פריטים
                </span>
              </div>

              {/* Alias resolution banner */}
              {resolvedAlias && resolvedAlias.queried === searchQuery && filteredUnified.length > 0 && (
                <div className="animate-banner-in mb-3 rounded-md border border-border bg-muted px-3 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5 dir-ltr">
                    <span className="text-muted-foreground shrink-0">שרשרת:</span>
                    {resolvedAlias.chain.map((code, i) => {
                      const isQueried = code === resolvedAlias.queried
                      const isCanonical = code === resolvedAlias.canonical
                      return (
                        <span key={code} className="inline-flex items-center gap-1.5">
                          {i > 0 && (
                            <span className="text-muted-foreground/40 text-[10px] select-none">←</span>
                          )}
                          <span className={cn(
                            'font-mono rounded px-1.5 py-0.5 transition-all',
                            isQueried && 'bg-primary text-primary-foreground font-bold shadow-sm shadow-primary/30',
                            isCanonical && !isQueried && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold ring-1 ring-emerald-500/30',
                            !isQueried && !isCanonical && 'text-muted-foreground/70',
                          )}>
                            {code}
                          </span>
                          {isCanonical && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">✓ נוכחי</span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Horizontally scrollable table */}
              <TooltipProvider delayDuration={0}>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="text-sm" style={{ minWidth: '1100px' }}>
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b">
                      {/* Group: פריט (sticky) */}
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0 sticky left-0 bg-background z-10 min-w-[200px]">
                        <span className="inline-flex items-center gap-1">פריט</span>
                      </th>

                      {/* Group: מלאי */}
                      <SortHeader field="stock_qty" className="text-end border-l border-muted px-2">מלאי</SortHeader>
                      <SortHeader field="price" className="text-end px-2">מחיר</SortHeader>
                      <SortHeader field="capital_tied" className="text-end px-2">הון כלוא</SortHeader>

                      {/* Group: ABC — column header dropdown filter */}
                      <th className="pb-2 font-medium text-center border-l border-muted px-2 whitespace-nowrap">
                        <div className="relative inline-block" ref={abcDropdownRef}>
                          <button
                            onClick={() => setAbcDropdownOpen(o => !o)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors',
                              abcFilter !== 'all'
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <Filter className="h-3 w-3" />
                            {abcFilter === 'all' ? 'ABC' : `ABC: ${abcFilter}`}
                            <ChevronDown className="h-2.5 w-2.5" />
                          </button>
                          {abcDropdownOpen && (
                            <div className="absolute top-full mt-1 start-0 z-50 min-w-[110px] rounded-md border bg-popover shadow-md text-popover-foreground">
                              {(['all', 'A', 'B', 'C'] as const).map((opt) => (
                                <button
                                  key={opt}
                                  onClick={() => { setAbcFilter(opt); setAbcDropdownOpen(false) }}
                                  className={cn(
                                    'flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors',
                                    abcFilter === opt && 'font-semibold text-primary'
                                  )}
                                >
                                  {opt === 'all' ? 'כל הקלאסים' : `קלאס ${opt}`}
                                  {abcFilter === opt && <span className="ms-auto">✓</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </th>
                      <SortHeader field="revenue_pct" className="text-end px-2">% הכנסות</SortHeader>

                      {/* Group: בריאות */}
                      <th className="pb-2 font-medium text-center border-l border-muted px-2 whitespace-nowrap">
                        <div className="relative inline-block" ref={tierDropdownRef}>
                          <button
                            onClick={() => setTierDropdownOpen(o => !o)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors',
                              tierFilter !== 'all'
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <Filter className="h-3 w-3" />
                            {tierFilter === 'all' ? 'סטטוס' : tierConfig[tierFilter].label}
                            <ChevronDown className="h-2.5 w-2.5" />
                          </button>
                          {tierDropdownOpen && (
                            <div className="absolute top-full mt-1 start-0 z-50 min-w-[110px] rounded-md border bg-popover shadow-md text-popover-foreground">
                              {(['all', 'critical', 'warning', 'ok', 'excess'] as const).map((opt) => (
                                <button
                                  key={opt}
                                  onClick={() => { setTierFilter(opt); setTierDropdownOpen(false) }}
                                  className={cn(
                                    'flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors',
                                    tierFilter === opt && 'font-semibold text-primary'
                                  )}
                                >
                                  {opt === 'all' ? 'כל הסטטוסים' : tierConfig[opt].label}
                                  {tierFilter === opt && <span className="ms-auto">✓</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </th>
                      <SortHeader field="days_of_supply" className="text-end px-2">ימי כיסוי</SortHeader>

                      {/* Group: ביקוש */}
                      <SortHeader field="sold_this_year" className="text-end border-l border-muted px-2">מכר/שנה</SortHeader>
                      <SortHeader field="sold_last_year" className="text-end px-2">מכר אשתקד</SortHeader>
                      <SortHeader field="inquiry_count" className="text-end px-2">פניות</SortHeader>

                      {/* Group: הזמנה */}
                      <SortHeader field="recommended_qty" className="text-end border-l border-muted px-2">להזמין</SortHeader>
                      <SortHeader field="urgency_score" className="text-end px-2">דחיפות</SortHeader>

                      {/* Group: היסטוריה */}
                      <SortHeader field="days_since_sale" className="text-end border-l border-muted px-2 pe-4 md:pe-0">ימים מהמכירה</SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnified.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item, idx) => {
                      const dos = item.days_of_supply
                      const chain = item.chain_history ?? [item.code, ...(item.alias_codes ?? [])]
                      return (
                        <tr
                          key={`${item.code}-${idx}`}
                          className={cn(
                            'border-b hover:bg-muted/50 transition-colors',
                            item.is_dead && 'bg-red-50/30 dark:bg-red-950/10',
                            !item.is_dead && item.is_at_risk && 'bg-amber-50/30 dark:bg-amber-950/10',
                          )}
                        >
                          {/* פריט (sticky) */}
                          <td className="py-2 ps-4 md:ps-0 sticky left-0 bg-background z-10 border-r border-muted/30">
                            <div className="font-medium leading-tight">{item.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{item.code}</div>
                            {item.alias_codes && item.alias_codes.length > 0 && (
                              chain.length >= 2 ? (
                                <UITooltip>
                                  <TooltipTrigger asChild>
                                    <div className="text-[10px] text-muted-foreground/60 cursor-help underline decoration-dotted">
                                      {item.alias_codes.slice(0, 2).join(', ')}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="font-mono text-xs">
                                    {chain.map((c, ci) => (
                                      <span key={c}>
                                        {ci > 0 && <span className="mx-1 opacity-60">→</span>}
                                        {c === item.code ? <strong>{c}</strong> : c}
                                      </span>
                                    ))}
                                  </TooltipContent>
                                </UITooltip>
                              ) : (
                                <div className="text-[10px] text-muted-foreground/60">{item.alias_codes.slice(0, 2).join(', ')}</div>
                              )
                            )}
                          </td>

                          {/* מלאי */}
                          <td className="py-2 text-end font-mono tabular-nums border-l border-muted/30 px-2">
                            <span>{item.stock_qty}</span>
                            {item.incoming_qty > 0 && (
                              <UITooltip>
                                <TooltipTrigger asChild>
                                  <span className="ms-1 text-[10px] text-emerald-500 cursor-help">+{item.incoming_qty}↓</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">בדרך למחסן: {item.incoming_qty}</TooltipContent>
                              </UITooltip>
                            )}
                            {item.ordered_qty > 0 && (
                              <UITooltip>
                                <TooltipTrigger asChild>
                                  <span className="ms-1 text-[10px] text-blue-400 cursor-help">+{item.ordered_qty}⏳</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">הוזמן מספק: {item.ordered_qty}</TooltipContent>
                              </UITooltip>
                            )}
                          </td>
                          <td className="py-2 text-end font-mono tabular-nums px-2">
                            {item.price > 0 ? `₪${item.price.toLocaleString()}` : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-2 text-end font-mono tabular-nums px-2">
                            {item.capital_tied > 0 ? `₪${item.capital_tied.toLocaleString()}` : <span className="text-muted-foreground/40">—</span>}
                          </td>

                          {/* ABC */}
                          <td className="py-2 text-center border-l border-muted/30 px-2">
                            {item.abc_class ? <ABCBadge cls={item.abc_class} /> : <span className="text-muted-foreground/40 text-xs">—</span>}
                          </td>
                          <td className="py-2 text-end tabular-nums px-2 text-xs">
                            {item.revenue_pct != null
                              ? <span className="text-muted-foreground">{item.revenue_pct >= 0.01 ? `${item.revenue_pct.toFixed(2)}%` : '<0.01%'}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>

                          {/* בריאות */}
                          <td className="py-2 text-center border-l border-muted/30 px-2">
                            <Badge variant={tierConfig[item.health_tier].variant} className="text-[10px]">
                              {tierConfig[item.health_tier].label}
                            </Badge>
                          </td>
                          <td className={cn(
                            'py-2 text-end tabular-nums font-mono text-xs px-2',
                            dos !== null && dos < 30 ? 'text-red-500 font-bold' : dos !== null && dos < 60 ? 'text-amber-500' : 'text-muted-foreground'
                          )}>
                            {dos !== null ? dos : '∞'}
                          </td>

                          {/* ביקוש */}
                          <td className="py-2 text-end tabular-nums border-l border-muted/30 px-2">
                            {item.sold_this_year > 0 ? item.sold_this_year : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-2 text-end tabular-nums px-2 text-muted-foreground">
                            {item.sold_last_year > 0 ? item.sold_last_year : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-2 text-end tabular-nums px-2">
                            {item.inquiry_count > 0 ? item.inquiry_count : <span className="text-muted-foreground/40">—</span>}
                          </td>

                          {/* הזמנה */}
                          <td className="py-2 text-end font-semibold border-l border-muted/30 px-2">
                            {item.recommended_qty > 0
                              ? <span className="text-amber-500">{item.recommended_qty}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="py-2 text-end font-mono tabular-nums px-2">
                            {item.urgency_score > 0
                              ? <span className={item.urgency_score > 5 ? 'text-amber-500 font-bold' : 'text-muted-foreground'}>{item.urgency_score}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>

                          {/* היסטוריה */}
                          <td className="py-2 text-end tabular-nums border-l border-muted/30 px-2 pe-4 md:pe-0">
                            {item.sale_date ? (
                              <div>
                                <div className="text-xs text-muted-foreground">{item.sale_date.substring(0, 10)}</div>
                                {item.days_since_sale != null && (
                                  <div className={cn('text-[10px]', item.days_since_sale > 365 ? 'text-red-500' : 'text-muted-foreground/60')}>
                                    {item.days_since_sale}d
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/40 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {filteredUnified.length === 0 && (
                      <tr>
                        <td colSpan={14} className="py-12 text-center text-muted-foreground">
                          {t('noInsights')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              </TooltipProvider>

              {/* Pagination */}
              {filteredUnified.length > PAGE_SIZE && (
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredUnified.length)} מתוך {filteredUnified.length} פריטים
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border text-xs transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    {Array.from({ length: Math.ceil(filteredUnified.length / PAGE_SIZE) }).map((_, i) => {
                      const total = Math.ceil(filteredUnified.length / PAGE_SIZE)
                      if (total <= 7 || i === 0 || i === total - 1 || Math.abs(i - page) <= 1) {
                        return (
                          <button
                            key={i}
                            onClick={() => setPage(i)}
                            className={cn(
                              'inline-flex h-7 min-w-7 items-center justify-center rounded border px-1.5 text-xs transition-colors',
                              page === i ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted'
                            )}
                          >
                            {i + 1}
                          </button>
                        )
                      }
                      if (Math.abs(i - page) === 2) return <span key={i} className="text-xs text-muted-foreground px-0.5">…</span>
                      return null
                    })}
                    <button
                      onClick={() => setPage(p => Math.min(Math.ceil(filteredUnified.length / PAGE_SIZE) - 1, p + 1))}
                      disabled={page >= Math.ceil(filteredUnified.length / PAGE_SIZE) - 1}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border text-xs transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {filteredUnified.length <= PAGE_SIZE && (
                <div className="mt-3 text-xs text-muted-foreground text-end">
                  {filteredUnified.length} פריטים
                </div>
              )}

              {/* Dead stock map — shown inline when מלאי מת quick view is active */}
              {quickView === 'dead' && (
                <div className="mt-6 border-t pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">מפת הון מלאי מת</span>
                      <Tabs value={String(yearsFilter)} onValueChange={(v) => { setYearsFilter(Number(v)); setTreemapPage(0) }}>
                        <TabsList>
                          <TabsTrigger value="1">{t('dead1Year')}</TabsTrigger>
                          <TabsTrigger value="2">{t('dead2Years')}</TabsTrigger>
                          <TabsTrigger value="3">{t('dead3Years')}</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex gap-4 text-sm">
                        <span className="text-muted-foreground">{t('items')}: <AnimatedCounter value={deadItems.length} className="font-semibold text-foreground" /></span>
                        <span className="text-muted-foreground">{t('capitalTied')}: <AnimatedCounter value={totalDeadCapital} format="currency" className="font-semibold text-foreground" /></span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" className="h-7 px-2" onClick={() => setViewMode('table')}>
                          <TableIcon className="h-4 w-4" />
                        </Button>
                        <Button variant={viewMode === 'map' ? 'default' : 'ghost'} size="sm" className="h-7 px-2" onClick={() => setViewMode('map')}>
                          <LayoutGrid className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  {deadLoading ? (
                    <Skeleton className="w-full h-[400px]" />
                  ) : viewMode === 'map' ? (
                    <DeadStockTreemap data={deadItems} isLoading={false} bare page={treemapPage} pageSize={50} onPageChange={setTreemapPage} />
                  ) : (
                    <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background z-10">
                          <tr className="border-b">
                            <th className="pb-2 font-medium text-start">{t('item')}</th>
                            <th className="pb-2 font-medium text-end">{t('stock')}</th>
                            <th className="pb-2 font-medium text-end">{t('price')}</th>
                            <th className="pb-2 font-medium text-end">{t('capitalTiedShort')}</th>
                            <th className="pb-2 font-medium text-end">{t('lastSale')}</th>
                            <th className="pb-2 font-medium text-end">{t('lastCount')}</th>
                            <th className="pb-2 font-medium text-end">{t('yearsDead2')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deadItems.map((item: any, idx: number) => (
                            <tr key={`${item.code}-${idx}`} className="border-b hover:bg-muted/50 transition-colors">
                              <td className="py-2">
                                <div className="font-medium">{item.name}</div>
                                <div className="text-xs text-muted-foreground">{item.code}</div>
                                {item.alias_codes && item.alias_codes.length > 0 && (
                                  <div className="text-[10px] text-muted-foreground/70">{t('alsoKnownAs')}: {item.alias_codes.join(', ')}</div>
                                )}
                              </td>
                              <td className="py-2 text-end">{item.stock_qty}</td>
                              <td className="py-2 text-end font-mono">&#8362;{item.price.toLocaleString()}</td>
                              <td className="py-2 text-end font-mono font-semibold">&#8362;{item.capital_tied.toLocaleString()}</td>
                              <td className="py-2 text-end text-xs text-muted-foreground">{item.sale_date ? item.sale_date.substring(0, 10) : t('neverSold')}</td>
                              <td className="py-2 text-end text-xs text-muted-foreground">{item.count_date ? item.count_date.substring(0, 10) : t('neverCounted')}</td>
                              <td className="py-2 text-end">
                                <Badge variant={item.years_dead >= 3 ? 'destructive' : item.years_dead >= 2 ? 'warning' : 'secondary'}>{item.years_dead}</Badge>
                              </td>
                            </tr>
                          ))}
                          {deadItems.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t('noInsights')}</td></tr>}
                        </tbody>
                      </table>
                      <div className="mt-2 text-xs text-muted-foreground text-end">{deadItems.length} {t('items')}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

    </div>
  )
}


export default function StockPage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <StockPageContent />
    </Suspense>
  )
}
