'use client'

/**
 * One headline number, with room to say where it came from.
 *
 * THIS IS THE MERGE OF TWO STATTILES. The dashboard carried its own 179-line
 * version used by 13 screens; the library carried this one. Same name, same
 * job, two implementations — the exact duplication a shared library exists to
 * remove. Neither was a superset, so this is the union:
 *
 *   from the dashboard's — `icon` and its tone-tinted chip, `changePercent`
 *     with `higherIsBetter` (a rise is only good when the metric says so —
 *     overdue debt going up is red though the arrow points the same way),
 *     `hint`, `onClick`, and <StatGrid>.
 *   from this one's — `provenance`, `spark`, `detail`, and the rule that a
 *     pending tile never draws a figure.
 *
 * WHY `pending` MATTERS MORE THAN IT LOOKS. /stock rendered four of these
 * reading `0` for nineteen seconds while the query was in flight, and a zero on
 * a dead-stock tile is an answer, not a wait — it is the answer a warehouse
 * manager acts on. The figure is withheld, not zeroed.
 *
 * `provenance` is optional and unstyled on purpose — pass a <Chip>. A tile that
 * can only show a figure is how a five-month-old snapshot passes for live, so
 * the slot exists even when a caller leaves it empty.
 *
 * `spark` exists so a ROW of tiles composes: four tiles where only two carry a
 * trend line read as four unrelated boxes rather than one header. The line
 * shows direction; the figure stays the only thing anyone reads a number off.
 */

import * as React from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { Swap, SkeletonBar } from './Swap'
import { Sparkline } from './charts'
import { useJanUI } from './provider'

/** Semantic tone. Drives the ICON tint and nothing else by default — a wall of
 *  tiles whose values are all coloured turns into a traffic light and stops
 *  meaning anything. `valueTone` opts a single tile into colouring its figure. */
export type StatTone = 'default' | 'good' | 'warn' | 'bad' | 'info'

const TONE: Record<StatTone, { fg: string; bg: string }> = {
  default: { fg: 'text-[var(--jan-dim)]', bg: 'bg-[var(--jan-raise)]' },
  good: { fg: 'text-[var(--jan-verdigris)]', bg: 'bg-[color-mix(in_srgb,var(--jan-verdigris)_12%,transparent)]' },
  warn: { fg: 'text-[var(--jan-callout)]', bg: 'bg-[var(--jan-callout-soft)]' },
  bad: { fg: 'text-[var(--jan-oxide)]', bg: 'bg-[color-mix(in_srgb,var(--jan-oxide)_12%,transparent)]' },
  info: { fg: 'text-[var(--jan-info)]', bg: 'bg-[color-mix(in_srgb,var(--jan-info)_12%,transparent)]' },
}

const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-[var(--jan-ink)]',
  good: 'text-[var(--jan-verdigris)]',
  warn: 'text-[var(--jan-callout)]',
  bad: 'text-[var(--jan-oxide)]',
  info: 'text-[var(--jan-info)]',
}

export interface StatTileProps {
  label: React.ReactNode
  /** Pre-formatted. Pass the host app's own currency/number formatter. */
  value: React.ReactNode
  icon?: LucideIcon
  tone?: StatTone
  /** Colour the FIGURE too, not just the icon. Off by default, deliberately. */
  valueTone?: boolean
  /** Percentage change vs the previous period (12.5 → `+12.5%`). */
  changePercent?: number
  /**
   * Whether a rise is good. Revenue up = good; overdue debt up = bad.
   * Defaults to true — set false on cost/debt/error metrics.
   */
  higherIsBetter?: boolean
  /** Beside the delta: "vs last month". */
  hint?: React.ReactNode
  /** Its own line under the value: the denominator, the window, the row count. */
  detail?: React.ReactNode
  /** Usually a <Chip> saying live / cached / sampled / unavailable. */
  provenance?: React.ReactNode
  /** The value is not known YET. Suppresses `value` — never renders as zero. */
  pending?: boolean
  /** Alias of `pending`, so call sites written against either name work. */
  loading?: boolean
  /** What is being read, for the pending state's own label. */
  waitingFor?: string
  /** Trend series. Direction sets the hue; it carries no readable scale. */
  spark?: number[]
  /** Index in a group, for the staggered entrance. */
  index?: number
  onClick?: () => void
  className?: string
}

export function StatTile({
  label, value, icon: Icon, tone = 'default', valueTone = false,
  changePercent, higherIsBetter = true, hint, detail, provenance,
  pending, loading, waitingFor, spark, index = 0, onClick, className,
}: StatTileProps) {
  const { isDeclineHidden } = useJanUI()
  const busy = !!(pending ?? loading)

  const direction =
    changePercent === undefined || !Number.isFinite(changePercent)
      ? null
      : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat'
  // `isPositive` already accounts for higherIsBetter — an overdue balance
  // falling is a NEGATIVE delta and good news, so it survives demo mode.
  const isPositive = direction === 'flat' ? null : direction === 'up' ? higherIsBetter : !higherIsBetter
  const hideDelta = isDeclineHidden(isPositive === false)

  const interactive = !!onClick

  return (
    <div
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!() } } : undefined}
      className={cn(
        'jan-anim rounded-[var(--jan-radius)] border border-[var(--jan-rule)] bg-[var(--jan-steel)] p-3.5',
        'motion-safe:animate-[jan-rise_var(--jan-base)_var(--jan-ease)_both]',
        // A clickable tile says so before it is clicked, and lifts by TRANSFORM
        // rather than by changing its box — animating a shadow or a border width
        // reflows the row of tiles beside it.
        interactive && [
          'cursor-pointer outline-none transition-[transform,border-color,box-shadow]',
          'duration-[var(--jan-fast)] ease-[var(--jan-ease)]',
          'motion-safe:hover:-translate-y-0.5 hover:border-[var(--jan-callout)]',
          'hover:shadow-[0_6px_20px_-10px_rgba(0,0,0,.35)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--jan-callout)]',
        ],
        className,
      )}
      style={{ animationDelay: `calc(${index} * var(--jan-stagger))` }}
    >
      <div className="flex items-start gap-2">
        {Icon && (
          <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', TONE[tone].bg)}>
            <Icon className={cn('size-3.5', TONE[tone].fg)} />
          </span>
        )}
        <span className="flex-1 truncate text-xs text-[var(--jan-dim)]">{label}</span>
        {provenance}
      </div>

      {/* The placeholder sits INSIDE the figure's own line so the line-height
          fixes the height and the tile cannot resize when the number lands. A
          skeleton shorter than the text it stands in for makes every tile in the
          row twitch at the moment the reader looks at it. Swap also withholds it
          entirely for an answer that returns inside 90ms — four frames of grey
          reads as a glitch, not as speed. */}
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', valueTone ? VALUE_TONE[tone] : 'text-[var(--jan-ink)]')}>
        <Swap pending={busy} skeleton={<SkeletonBar w="6ch" h={22} />}>
          {value}
        </Swap>
      </div>

      {busy ? (
        <div className="mt-0.5 text-[11px] text-[var(--jan-faint)]">
          {waitingFor ? `קורא ${waitingFor}…` : 'טוען…'}
        </div>
      ) : (
        ((direction && !hideDelta) || hint || detail) && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            {direction && !hideDelta && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 font-medium tabular-nums',
                  isPositive === null && 'text-[var(--jan-faint)]',
                  isPositive === true && 'text-[var(--jan-verdigris)]',
                  isPositive === false && 'text-[var(--jan-oxide)]',
                )}
              >
                {direction === 'up' && <TrendingUp className="size-3" />}
                {direction === 'down' && <TrendingDown className="size-3" />}
                {direction === 'flat' && <Minus className="size-3" />}
                {`${changePercent! > 0 ? '+' : ''}${changePercent!.toFixed(1)}%`}
              </span>
            )}
            {(hint || detail) && <span className="truncate text-[var(--jan-faint)]">{hint ?? detail}</span>}
          </div>
        )
      )}

      {/* Drawn only with a real series AND a real value: a trend line beside a
          skeleton implies the figure it is a trend of has already arrived. */}
      {!busy && spark && spark.length > 1 && (
        <Sparkline values={spark} height={26} draw className="mt-2" />
      )}
    </div>
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
  return <div className={cn('grid gap-2 sm:gap-3', COLUMN_CLASSES[columns], className)}>{children}</div>
}

export default StatTile
