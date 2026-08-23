'use client'

import type React from 'react'
import { useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { ChartGrid, AXIS_PROPS } from '@/components/charts/kit'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatCurrency, formatCurrencyAxis } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { cn } from '@/lib/utils'

interface ComparisonChartProps {
  data: Array<{ date: string; current: number; previous: number; previousDate?: string }>
  title?: string
  isLoading?: boolean
  headerActions?: React.ReactNode
}

type SeriesKey = 'current' | 'previous'

type ChartPoint = {
  date: string
  current: number
  previous: number
  previousDate?: string
  /** Weekly bucket covering only part of its week — see rollupWeekly(). */
  partial?: boolean
}

type Granularity = 'day' | 'week'

/**
 * Above this many points the daily line is noise, not signal — Jan Parts is
 * closed Saturdays, so a 90-day daily series spends a seventh of its width at
 * zero and every real trend hides behind the sawtooth.
 */
const ROLLUP_THRESHOLD = 45

/** Sunday starting the week containing `iso` — the Israeli week, matching the
 *  page's own Sunday alignment for the previous period. */
function weekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split('T')[0]
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

/**
 * Sum both series into weekly buckets, keeping the previous period's own
 * week-start as the tooltip's `previousDate`.
 *
 * The edge buckets are almost always PARTIAL — a 90-day window starts and ends
 * mid-week — so a full week is compared against two or three days and the line
 * appears to collapse at both ends. Those buckets are flagged rather than
 * dropped: hiding them would silently shorten the period the header totals are
 * computed over.
 */
function rollupWeekly(data: ComparisonChartProps['data']): ChartPoint[] {
  const buckets = new Map<string, ChartPoint>()
  for (const d of data) {
    const key = weekStart(d.date)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.current += d.current
      bucket.previous += d.previous
    } else {
      buckets.set(key, {
        date: key,
        current: d.current,
        previous: d.previous,
        previousDate: d.previousDate ? weekStart(d.previousDate) : '',
      })
    }
  }

  const dates = data.map(d => d.date)
  const first = dates.reduce((a, b) => (a < b ? a : b))
  const last = dates.reduce((a, b) => (a > b ? a : b))
  for (const bucket of buckets.values()) {
    bucket.partial = bucket.date < first || addDays(bucket.date, 6) > last
  }
  return Array.from(buckets.values())
}

/** `2026-08-23` → `23.8`. Full ISO dates at every tick were unreadable at 90 days. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  if (!m || !d) return iso
  return `${Number(d)}.${Number(m)}`
}

type Translate = ReturnType<typeof useLocale>['t']

interface TooltipRenderProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: ChartPoint }>
  label?: React.ReactNode
  t: Translate
}

function CustomTooltip({ active, payload, label, t }: TooltipRenderProps) {
  if (!active || !payload?.length) return null

  const row = payload[0]?.payload
  const current = Number(row?.current ?? 0)
  const previous = Number(row?.previous ?? 0)
  // A 0 baseline has no meaningful percentage — show the values and no delta
  // rather than an Infinity or a misleading "+100%".
  const delta = previous > 0 ? ((current - previous) / previous) * 100 : null

  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-sm">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {row?.partial && <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{t('partialWeek')}</span>}
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--primary)' }} />
            {t('current')}
          </span>
          <span className="font-semibold tabular-nums">{formatCurrency(current)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
            {t('previous')}
            {row?.previousDate ? <span className="text-xs opacity-70">({row.previousDate})</span> : null}
          </span>
          <span className="tabular-nums">{formatCurrency(previous)}</span>
        </div>
      </div>
      {delta !== null && (
        <div
          className={cn(
            'mt-1.5 border-t border-border pt-1.5 text-xs font-medium tabular-nums',
            delta >= 0 ? 'text-emerald-500' : 'text-red-500',
          )}
        >
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  )
}

export function ComparisonChart({ data, title, isLoading, headerActions }: ComparisonChartProps) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  const moneyHidden = useMoneyHidden()

  const { t } = useLocale()
  const displayTitle = title || t('periodComparison')

  // null = both series shown. Clicking a chip isolates it; clicking again clears.
  const [isolated, setIsolated] = useState<SeriesKey | null>(null)
  // null = follow the point count; a click pins the user's choice for the session.
  const [granularityOverride, setGranularityOverride] = useState<Granularity | null>(null)

  const autoGranularity: Granularity = data.length > ROLLUP_THRESHOLD ? 'week' : 'day'
  const granularity = granularityOverride ?? autoGranularity
  const canRollup = data.length > 7

  const series: ChartPoint[] = useMemo(
    () => (granularity === 'week' ? rollupWeekly(data) : data),
    [data, granularity],
  )

  const stats = useMemo(() => {
    if (!series.length) return null
    let currentTotal = 0
    let previousTotal = 0
    // A partial edge bucket can never be the peak, and a complete one should
    // not lose the marker to it either — rank whole buckets only.
    const whole = series.filter(d => !d.partial)
    let peak = (whole.length ? whole : series)[0]
    for (const d of series) {
      currentTotal += d.current
      previousTotal += d.previous
    }
    for (const d of (whole.length ? whole : series)) {
      if (d.current > peak.current) peak = d
    }
    const average = currentTotal / series.length
    const delta = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null
    return { currentTotal, previousTotal, average, peak, delta }
  }, [series])

  const showCurrent = isolated !== 'previous'
  const showPrevious = isolated !== 'current'

  // Remounting on shape change replays the draw-in animation, so switching
  // period reads as the chart redrawing rather than values teleporting.
  const animationKey = `${granularity}-${series.length}-${series[0]?.date ?? ''}`

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap pb-3">
        <div className="space-y-2">
          <CardTitle>{displayTitle}</CardTitle>
          {stats && !isLoading && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <SeriesChip
                label={t('current')}
                value={formatCurrency(stats.currentTotal)}
                color="var(--primary)"
                active={showCurrent}
                title={t('isolateSeries')}
                onClick={() => setIsolated(isolated === 'current' ? null : 'current')}
              />
              <SeriesChip
                label={t('previous')}
                value={formatCurrency(stats.previousTotal)}
                color="var(--muted-foreground)"
                active={showPrevious}
                title={t('isolateSeries')}
                onClick={() => setIsolated(isolated === 'previous' ? null : 'previous')}
              />
              {stats.delta !== null && (
                <span
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    stats.delta >= 0 ? 'text-emerald-500' : 'text-red-500',
                  )}
                >
                  {stats.delta >= 0 ? '▲' : '▼'} {Math.abs(stats.delta).toFixed(1)}%
                </span>
              )}
              {/* Legend for the dashed reference line, which carries no label
                  of its own. */}
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="h-px w-4 border-t border-dashed border-muted-foreground" />
                {t('chartAverage')}
                <span className="tabular-nums">{formatCurrency(stats.average)}</span>
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canRollup && (
            <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
              {(['day', 'week'] as const).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularityOverride(g)}
                  aria-pressed={granularity === g}
                  className={cn(
                    'rounded px-2 py-1 transition-colors',
                    granularity === g
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {g === 'day' ? t('byDay') : t('byWeek')}
                </button>
              ))}
            </div>
          )}
          {headerActions}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="w-full h-[200px] sm:h-[260px] lg:h-[330px]" />
          </div>
        ) : series.length === 0 ? (
          <div className="flex items-center justify-center h-[220px] sm:h-[280px] lg:h-[350px] text-muted-foreground text-sm">
            {t('noInsights')}
          </div>
        ) : (
        <div className="h-[220px] sm:h-[280px] lg:h-[350px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minHeight={120}>
          <AreaChart key={animationKey} data={series} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="currentGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="previousGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity={0.09} />
                <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* Horizontal rules only: the vertical half of the old crosshatch
                competed with the series without locating anything the tooltip
                does not already say. */}
            <ChartGrid />
            <XAxis
              dataKey="date"
              {...AXIS_PROPS}
              tickFormatter={shortDate}
              minTickGap={28}
            />
            <YAxis
              {...AXIS_PROPS}
              tickFormatter={(v) => formatCurrencyAxis(v)}
              width={moneyHidden ? 8 : 48}
            />
            <Tooltip
              content={(props) => (
                <CustomTooltip
                  active={props.active}
                  payload={props.payload}
                  label={props.label}
                  t={t}
                />
              )}
              cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.6 }}
            />
            {/* Period average: the one horizontal reference that says whether a
                bucket beat the run rate. Deliberately UNLABELLED — a Hebrew
                label anchored inside an LTR plot clips against whichever edge
                it is pinned to, and the figure itself already sits in the
                header chips above the chart. */}
            {stats && (
              <ReferenceLine
                y={stats.average}
                stroke="var(--muted-foreground)"
                strokeDasharray="2 4"
                strokeOpacity={0.5}
              />
            )}
            {showPrevious && (
              <Area
                type="monotone"
                dataKey="previous"
                name={t('previous')}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.38}
                strokeWidth={1.25}
                fill="url(#previousGrad)"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                animationDuration={700}
                animationEasing="ease-out"
              />
            )}
            {showCurrent && (
              <Area
                type="monotone"
                dataKey="current"
                name={t('current')}
                stroke="var(--primary)"
                strokeWidth={2.25}
                strokeLinecap="round"
                fill="url(#currentGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
                animationDuration={900}
                animationEasing="ease-out"
              />
            )}
            {/* Partial weekly buckets, ringed rather than filled. Only the
                first and last bucket can ever be partial, so this renders at
                most two dots. */}
            {showCurrent && series.filter(d => d.partial).map(d => (
              <ReferenceDot
                key={`partial-${d.date}`}
                x={d.date}
                y={d.current}
                r={3.5}
                fill="var(--background)"
                stroke="var(--primary)"
                strokeWidth={1.5}
                strokeDasharray="2 2"
                zIndex={1}
              />
            ))}
            {/* Peak day, marked once. A chart that points at its own outlier
                saves the reader a hover-hunt across 90 points. */}
            {stats && showCurrent && (
              <ReferenceDot
                x={stats.peak.date}
                y={stats.peak.current}
                r={4}
                fill="var(--primary)"
                stroke="var(--background)"
                strokeWidth={2}
                zIndex={1}
                label={{
                  value: `${t('chartPeak')} · ${shortDate(stats.peak.date)}`,
                  position: 'top',
                  fontSize: 10,
                  fill: 'var(--muted-foreground)',
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        </div>
        )}
      </CardContent>
    </Card>
  )
}

function SeriesChip({ label, value, color, active, title, onClick }: {
  label: string
  value: string
  color: string
  active: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm transition-opacity hover:bg-accent',
        !active && 'opacity-40',
      )}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </button>
  )
}
