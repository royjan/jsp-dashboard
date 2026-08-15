'use client'

/**
 * <StatTile> / <StatGrid> — the compact KPI row that 35 pages were hand-rolling
 * as `<Card><CardContent className="p-4">` + icon + label + value, each with its
 * own padding, icon size and value weight.
 *
 * Relationship to <KPICard>: KPICard is the BIG overview tile — it animates its
 * number with AnimatedCounter and shows a period-over-period trend. StatTile is
 * the dense one-line stat used on inner pages. Same visual language, different
 * weight. Use KPICard on the overview, StatTile everywhere else.
 *
 * Values are pre-formatted strings — pass `formatCurrency(x)` / `formatNumber(x)`
 * from `@/lib/format` so money looks the same here as it does in tables.
 */

import * as React from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cardVariants } from '@/lib/motion'
import { formatPercentDelta } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Semantic tone. Drives the icon tint — never the value colour, which stays
 *  `foreground` so a wall of tiles doesn't turn into a traffic light. */
export type StatTone = 'default' | 'good' | 'warn' | 'bad' | 'info'

const TONE_CLASSES: Record<StatTone, { icon: string; bg: string }> = {
  default: { icon: 'text-muted-foreground', bg: 'bg-muted' },
  good: { icon: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  warn: { icon: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  bad: { icon: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10' },
  info: { icon: 'text-primary', bg: 'bg-primary/10' },
}

export interface StatTileProps {
  label: React.ReactNode
  /** Pre-formatted. Use `@/lib/format` helpers. */
  value: React.ReactNode
  icon?: LucideIcon
  tone?: StatTone
  /** Percentage change vs the previous period (12.5 → `+12.5%`). */
  changePercent?: number
  /**
   * Whether a rise is good. Revenue up = good; overdue debt up = bad.
   * Defaults to true — set false on cost/debt/error metrics.
   */
  higherIsBetter?: boolean
  /** Small note under the value ("vs last month", "מתוך 1,240"). */
  hint?: React.ReactNode
  /** Show a skeleton instead of the value. */
  loading?: boolean
  /** Index for the staggered entrance. Pass the map index. */
  index?: number
  onClick?: () => void
  className?: string
}

export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'default',
  changePercent,
  higherIsBetter = true,
  hint,
  loading,
  index = 0,
  onClick,
  className,
}: StatTileProps) {
  const toneClasses = TONE_CLASSES[tone]

  // A rise is only "good" when the metric says so — overdue balance going up
  // is red even though the arrow points the same way.
  const direction =
    changePercent === undefined || !Number.isFinite(changePercent)
      ? null
      : changePercent > 0
        ? 'up'
        : changePercent < 0
          ? 'down'
          : 'flat'
  const isPositive = direction === 'flat' ? null : direction === 'up' ? higherIsBetter : !higherIsBetter

  return (
    <motion.div custom={index} variants={cardVariants} initial="hidden" animate="visible">
      <Card
        className={cn(
          'h-full transition-colors',
          onClick && 'cursor-pointer hover:border-primary/40 hover:bg-muted/30',
          className,
        )}
        onClick={onClick}
      >
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {Icon && (
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', toneClasses.bg)}>
                <Icon className={cn('h-3.5 w-3.5', toneClasses.icon)} />
              </span>
            )}
            <span className="truncate">{label}</span>
          </div>

          <div className="mt-1.5 text-lg font-bold tabular-nums sm:text-xl">
            {loading ? <Skeleton className="h-6 w-24" /> : value}
          </div>

          {(direction || hint) && !loading && (
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              {direction && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 font-medium tabular-nums',
                    isPositive === null && 'text-muted-foreground',
                    isPositive === true && 'text-emerald-600 dark:text-emerald-400',
                    isPositive === false && 'text-red-600 dark:text-red-400',
                  )}
                >
                  {direction === 'up' && <TrendingUp className="h-3 w-3" />}
                  {direction === 'down' && <TrendingDown className="h-3 w-3" />}
                  {direction === 'flat' && <Minus className="h-3 w-3" />}
                  {formatPercentDelta(changePercent)}
                </span>
              )}
              {hint && <span className="truncate text-muted-foreground">{hint}</span>}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export interface StatGridProps {
  children: React.ReactNode
  /**
   * Tiles per row at the widest breakpoint. The narrow-screen counts are fixed
   * (2 on mobile, 3 on small) so a 5-up row degrades the same way everywhere.
   */
  columns?: 2 | 3 | 4 | 5 | 6
  className?: string
}

const COLUMN_CLASSES: Record<NonNullable<StatGridProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
}

export function StatGrid({ children, columns = 4, className }: StatGridProps) {
  return (
    <div className={cn('grid gap-2 sm:gap-3', COLUMN_CLASSES[columns], className)}>{children}</div>
  )
}

export default StatTile
