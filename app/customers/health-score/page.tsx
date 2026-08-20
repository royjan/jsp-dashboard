'use client'

import { useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useCustomerHealth } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { HealthTransitions } from '@/components/customers/HealthTransitions'
import { WinBackSuggestions } from '@/components/customers/WinBackSuggestions'
import { SubTabs } from '@/components/shared/SubTabs'
import { cn } from '@/lib/utils'
import {
  HeartPulse,
  AlertCircle,
  ShieldCheck,
  Eye,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Play,
  Loader2,
} from 'lucide-react'
import { formatCurrency, formatNumber, formatRatio, formatPercentDelta } from '@/lib/format'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { sortRows } from '@/lib/sort'
import { useMoneyHidden } from '@/lib/use-money-hidden'

type Band = 'green' | 'yellow' | 'red' | 'all'
type SortField = 'score' | 'name' | 'revenue' | 'days' | 'returnRate'
type SortDir = 'asc' | 'desc'

interface HealthScore {
  code: string
  name: string
  score: number
  band: 'green' | 'yellow' | 'red'
  factors: {
    returnRate: number
    daysSinceLastPurchase: number | null
    trend: 'up' | 'down' | 'stable'
    yoyChangePct: number | null
  }
  penalties: { returnRate: number; recency: number; trend: number }
  total_revenue: number
  last_purchase: string
}

const BAND_STYLE: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  red: 'bg-red-500/15 text-red-500 border-red-500/30',
}

/**
 * How each sortable column pulls its comparable value. Nested/derived fields
 * (`factors.*`) can't be inferred from the column key, so they live here.
 * A customer who has never purchased sorts as "longest ago", not as blank.
 */
const HEALTH_SORT_VALUES: Record<SortField, (r: HealthScore) => unknown> = {
  score: r => r.score,
  name: r => r.name,
  revenue: r => r.total_revenue,
  days: r => r.factors.daysSinceLastPurchase ?? Number.MAX_SAFE_INTEGER,
  returnRate: r => r.factors.returnRate,
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up')
    return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
  if (trend === 'down')
    return <TrendingDown className="h-3.5 w-3.5 text-red-500" />
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />
}

function ScoreBar({ score, band }: { score: number; band: 'green' | 'yellow' | 'red' }) {
  const color =
    band === 'green'
      ? 'bg-emerald-500'
      : band === 'yellow'
        ? 'bg-amber-500'
        : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full transition-all', color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-mono font-semibold tabular-nums min-w-[2.5ch]">
        {score}
      </span>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-20 mb-3" />
              <Skeleton className="h-8 w-24 mb-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function HealthScoreContent() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(`${currentYear}-01-01`)
  const [dateTo, setDateTo] = useState(today)
  const [bandFilter, setBandFilter] = useState<Band>('all')
  const [sort, setSort] = useState<SortField>('score')
  const [dir, setDir] = useState<SortDir>('asc') // show worst first by default
  const [searchQuery, setSearchQuery] = useState('')
  const [runningCheck, setRunningCheck] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  const { data, isLoading, error } = useCustomerHealth(dateFrom, dateTo)

  const filtered = useMemo(() => {
    if (!data?.scores) return []
    let rows = data.scores as HealthScore[]
    if (bandFilter !== 'all') rows = rows.filter(r => r.band === bandFilter)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      rows = rows.filter(
        r =>
          r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q),
      )
    }
    // Ordering uses the shared comparator; `sort`/`dir` stay here so the band
    // filter and the sort live in one place (DataTable runs controlled).
    return sortRows(rows, HEALTH_SORT_VALUES[sort], dir)
  }, [data, bandFilter, sort, dir, searchQuery])

  const handleRunHealthCheck = async () => {
    setRunningCheck(true)
    setCheckResult(null)
    try {
      const res = await fetch('/api/cron/health-check')
      const result = await res.json()
      if (result.ok) {
        const msg = `${t('healthCheckComplete')}: ${result.customersScored} ${t('customers').toLowerCase()}, ${result.transitionsCreated} ${t('healthTransitions').toLowerCase()} (${result.deteriorated} ${t('deteriorating').toLowerCase()}, ${result.improved} ${t('improving').toLowerCase()})`
        setCheckResult(msg)
      } else {
        setCheckResult(result.error || 'Failed')
      }
    } catch {
      setCheckResult('Failed to run health check')
    } finally {
      setRunningCheck(false)
    }
  }

  if (isLoading) return <LoadingSkeleton />
  if (error)
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-50" />
          Failed to load
        </CardContent>
      </Card>
    )
  if (!data) return null

  const dist = data.distribution as { green: number; yellow: number; red: number }
  const total = dist.green + dist.yellow + dist.red
  const allScores = (data.scores || []) as HealthScore[]

  const healthColumns: DataTableColumn<HealthScore, SortField>[] = [
    { key: 'score', header: t('healthScore'), sortable: true, cell: row => <ScoreBar score={row.score} band={row.band} /> },
    {
      key: 'name', header: t('customer') || 'Customer', sortable: true,
      cell: row => (
        <>
          <Link href={`/customers/${row.code}`} className="block max-w-[200px] truncate font-medium text-primary hover:underline">
            {row.name}
          </Link>
          <div className="text-xs text-muted-foreground">{row.code}</div>
        </>
      ),
    },
    { key: 'revenue', header: t('revenue') || 'Revenue', align: 'end', sortable: true, cellClassName: 'font-mono', cell: row => formatCurrency(row.total_revenue) },
    { key: 'days', header: t('daysSinceLastOrder'), align: 'end', sortable: true, cellClassName: 'text-muted-foreground', cell: row => row.factors.daysSinceLastPurchase ?? '—' },
    {
      key: 'returnRate', header: t('returnRate'), align: 'end', sortable: true,
      cell: row => (
        <Badge variant="outline" className={cn('font-mono', row.factors.returnRate > 0.1 && 'text-red-500')}>
          {formatRatio(row.factors.returnRate)}
        </Badge>
      ),
    },
    { key: 'trend', header: t('trend') || 'Trend', align: 'center', cell: row => <TrendIcon trend={row.factors.trend} /> },
    {
      key: 'yoy', header: t('yoyChange'), align: 'end',
      cell: row =>
        row.factors.yoyChangePct !== null ? (
          <span className={cn('font-mono', row.factors.yoyChangePct > 0 ? 'text-emerald-500' : row.factors.yoyChangePct < 0 ? 'text-red-500' : 'text-muted-foreground')}>
            {formatPercentDelta(row.factors.yoyChangePct, 0)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <div className="space-y-4 md:space-y-6">
      <SubTabs
        tabs={[
          { href: '/customers', label: t('customers') },
          { href: '/customers/health-score', label: t('customerHealth') },
        ]}
      />
      {/* Top bar: search, health check button, date picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative min-w-[180px] sm:max-w-xs flex-1">
            <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('searchPlaceholder') || 'Search...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent ps-8 pe-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunHealthCheck}
            disabled={runningCheck}
            className="gap-1.5 shrink-0"
          >
            {runningCheck ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {runningCheck ? t('runningHealthCheck') : t('runHealthCheck')}
          </Button>
        </div>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => {
            setDateFrom(from)
            setDateTo(to)
          }}
        />
      </div>

      {/* Health check result message */}
      {checkResult && (
        <div className="text-sm text-muted-foreground bg-muted rounded-md p-3">
          {checkResult}
        </div>
      )}

      {/* Recent Changes (Transitions) */}
      <HealthTransitions />

      {/* Win-Back Suggestions */}
      <WinBackSuggestions scores={allScores} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
                <HeartPulse className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('healthScore')}</span>
              </div>
              <div className="text-xl md:text-2xl font-bold text-primary">
                <AnimatedCounter value={data.avgScore} />
              </div>
              <div className="text-[11px] md:text-xs text-muted-foreground mt-1">
                avg / {formatNumber(total)} {t('total').toLowerCase()}
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('healthyCustomers')}</span>
              </div>
              <div className="text-xl md:text-2xl font-bold text-emerald-500">
                <AnimatedCounter value={dist.green} />
              </div>
              <div className="text-[11px] md:text-xs text-muted-foreground mt-1">
                {total > 0 ? Math.round((dist.green / total) * 100) : 0}%
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
                <Eye className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('watchList')}</span>
              </div>
              <div className="text-xl md:text-2xl font-bold text-amber-500">
                <AnimatedCounter value={dist.yellow} />
              </div>
              <div className="text-[11px] md:text-xs text-muted-foreground mt-1">
                {total > 0 ? Math.round((dist.yellow / total) * 100) : 0}%
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('atRisk')}</span>
              </div>
              <div className="text-xl md:text-2xl font-bold text-red-500">
                <AnimatedCounter value={dist.red} />
              </div>
              <div className="text-[11px] md:text-xs text-muted-foreground mt-1">
                {formatCurrency(data.atRiskRevenue || 0)}{' '}
                {t('atRiskRevenue')}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Band filter tabs */}
      <Tabs value={bandFilter} onValueChange={v => setBandFilter(v as Band)}>
        <TabsList>
          <TabsTrigger value="all">All ({formatNumber(total)})</TabsTrigger>
          <TabsTrigger value="red" className="gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-red-500" />
            {t('atRisk')} ({formatNumber(dist.red)})
          </TabsTrigger>
          <TabsTrigger value="yellow" className="gap-1.5">
            <Eye className="h-3.5 w-3.5 text-amber-500" />
            {t('watchList')} ({formatNumber(dist.yellow)})
          </TabsTrigger>
          <TabsTrigger value="green" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            {t('healthyCustomers')} ({formatNumber(dist.green)})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {t('customers')} ({formatNumber(filtered.length)})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={filtered}
            columns={healthColumns}
            getRowKey={row => row.code}
            sort={{ field: sort, dir }}
            onSortChange={next => { setSort(next.field); setDir(next.dir) }}
            minWidth="min-w-[800px]"
            maxHeight="600px"
            // Was a hard `.slice(0, 200)` with an English-only "Showing first
            // 200" note and no way to see the rest.
            maxRows={200}
            labels={{ empty: t('noInsights') || 'No customers' }}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default function HealthScorePage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <HealthScoreContent />
    </Suspense>
  )
}
