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
import { ILS_FORMAT, formatNumber } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  HeartPulse,
  AlertCircle,
  ShieldCheck,
  Eye,
  ArrowUpDown,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Play,
  Loader2,
} from 'lucide-react'

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
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0
      switch (sort) {
        case 'score':
          cmp = a.score - b.score
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'revenue':
          cmp = a.total_revenue - b.total_revenue
          break
        case 'days':
          cmp =
            (a.factors.daysSinceLastPurchase ?? Infinity) -
            (b.factors.daysSinceLastPurchase ?? Infinity)
          break
        case 'returnRate':
          cmp = a.factors.returnRate - b.factors.returnRate
          break
      }
      return dir === 'desc' ? -cmp : cmp
    })
    return sorted
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

  const Header = ({
    field,
    children,
    className,
  }: {
    field: SortField
    children: React.ReactNode
    className?: string
  }) => (
    <th
      className={cn(
        'pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap',
        className,
      )}
      onClick={() => {
        if (sort === field) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
        else {
          setSort(field)
          setDir(field === 'score' || field === 'days' ? 'desc' : 'desc')
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown
          className={cn(
            'h-3 w-3 shrink-0',
            sort === field ? 'text-foreground' : 'text-muted-foreground/50',
          )}
        />
      </span>
    </th>
  )

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
                {ILS_FORMAT.format(data.atRiskRevenue || 0)}{' '}
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
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto -mx-4 md:mx-0">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b">
                  <Header field="score" className="text-start ps-4 md:ps-0">
                    {t('healthScore')}
                  </Header>
                  <Header field="name" className="text-start">
                    {t('customer') || 'Customer'}
                  </Header>
                  <Header field="revenue" className="text-end">
                    {t('revenue') || 'Revenue'}
                  </Header>
                  <Header field="days" className="text-end">
                    {t('daysSinceLastOrder')}
                  </Header>
                  <Header field="returnRate" className="text-end">
                    {t('returnRate')}
                  </Header>
                  <th className="text-center pb-2 font-medium">
                    {t('trend') || 'Trend'}
                  </th>
                  <th className="text-end pb-2 font-medium pe-4 md:pe-0">
                    {t('yoyChange')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((row, idx) => (
                  <tr
                    key={row.code}
                    className="border-b hover:bg-muted/50 transition-colors"
                  >
                    <td className="py-2.5 ps-4 md:ps-0">
                      <ScoreBar score={row.score} band={row.band} />
                    </td>
                    <td className="py-2.5">
                      <Link
                        href={`/customers/${row.code}`}
                        className="font-medium text-primary hover:underline block truncate max-w-[200px]"
                      >
                        {row.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {row.code}
                      </div>
                    </td>
                    <td className="py-2.5 text-end font-mono tabular-nums">
                      {ILS_FORMAT.format(row.total_revenue)}
                    </td>
                    <td className="py-2.5 text-end tabular-nums text-muted-foreground">
                      {row.factors.daysSinceLastPurchase ?? '—'}
                    </td>
                    <td className="py-2.5 text-end tabular-nums">
                      <Badge
                        variant="outline"
                        className={cn(
                          'font-mono',
                          row.factors.returnRate > 0.1 && 'text-red-500',
                        )}
                      >
                        {(row.factors.returnRate * 100).toFixed(1)}%
                      </Badge>
                    </td>
                    <td className="py-2.5 text-center">
                      <TrendIcon trend={row.factors.trend} />
                    </td>
                    <td className="py-2.5 text-end tabular-nums pe-4 md:pe-0">
                      {row.factors.yoyChangePct !== null ? (
                        <span
                          className={cn(
                            'font-mono',
                            row.factors.yoyChangePct > 0
                              ? 'text-emerald-500'
                              : row.factors.yoyChangePct < 0
                                ? 'text-red-500'
                                : 'text-muted-foreground',
                          )}
                        >
                          {row.factors.yoyChangePct > 0 ? '+' : ''}
                          {row.factors.yoyChangePct.toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-12 text-center text-muted-foreground"
                    >
                      {t('noInsights') || 'No customers'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 200 && (
            <div className="text-xs text-muted-foreground text-center pt-3 border-t mt-3">
              Showing first 200 / {formatNumber(filtered.length)}
            </div>
          )}
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
