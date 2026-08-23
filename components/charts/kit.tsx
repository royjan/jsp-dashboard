'use client'

/**
 * kit.tsx — the shared look for every chart in this app.
 *
 * Before this file the same decisions were re-made per chart: 14 hand-copied
 * tooltip `contentStyle` objects, 28 full-crosshatch grids, 22 hard-coded hex
 * fills and 15 recharts `<Legend>`s that truncated Hebrew customer names to
 * "מ.ב.גבע שרותי ר…". Charts drifted apart because nothing held them together,
 * not because anyone chose differently.
 *
 * Import the pieces; do not re-derive them.
 *
 * Axis/grid/text COLOURS still come from the `.recharts-*` overrides in
 * globals.css — this file owns shape, weight and behaviour.
 */

import type React from 'react'
import { useState, useCallback } from 'react'
import { CartesianGrid } from 'recharts'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Axes & grid
// ---------------------------------------------------------------------------

/**
 * Horizontal rules only, and no axis spines.
 *
 * The vertical half of a crosshatch locates a point the tooltip already names,
 * at the cost of competing with the series for the reader's eye. Categorical
 * charts (a bar per customer) are the one case where the vertical half helps,
 * so `<ChartGrid vertical />` stays available.
 */
export function ChartGrid({ vertical = false, horizontal = true }: { vertical?: boolean; horizontal?: boolean }) {
  return (
    <CartesianGrid
      vertical={vertical}
      horizontal={horizontal}
      stroke="var(--chart-grid)"
      strokeOpacity={0.5}
    />
  )
}

/** Tick/axis props shared by every cartesian chart. Spread, then override. */
export const AXIS_PROPS = {
  tick: { fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const

/** Series draw-in. Slower for the primary line so it reads as one motion. */
export const ANIM = {
  primary: { animationDuration: 900, animationEasing: 'ease-out' },
  secondary: { animationDuration: 700, animationEasing: 'ease-out' },
} as const

/** Dashed vertical crosshair for line/area charts. */
export const CROSSHAIR = {
  stroke: 'var(--primary)',
  strokeWidth: 1,
  strokeDasharray: '4 4',
  strokeOpacity: 0.6,
} as const

/** Bars: one rounded end, pointing the way the bar grows. */
export const BAR_RADIUS = {
  vertical: [4, 4, 0, 0] as [number, number, number, number],
  /** Horizontal bars in an RTL page still grow left→right in the SVG. */
  horizontal: [0, 4, 4, 0] as [number, number, number, number],
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export interface TooltipRow {
  label: string
  value: string
  color?: string
  muted?: boolean
}

/**
 * The one tooltip shell. Callers map their payload to rows and keep control of
 * formatting — currency, units and masking differ per chart and this file must
 * not guess at them.
 */
export function ChartTooltipShell({ title, rows, footer }: {
  title?: React.ReactNode
  rows: TooltipRow[]
  footer?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-sm">
      {title != null && <div className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</div>}
      <div className="space-y-1 text-sm">
        {rows.map((r, i) => (
          <div
            key={`${r.label}-${i}`}
            className={cn('flex items-center justify-between gap-4', r.muted && 'text-muted-foreground')}
          >
            <span className="flex items-center gap-1.5">
              {r.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />}
              {r.label}
            </span>
            <span className={cn('tabular-nums', !r.muted && 'font-semibold')}>{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-border pt-1.5 text-xs">{footer}</div>}
    </div>
  )
}

/** Signed change, coloured and arrowed. `null` when the baseline is 0. */
export function DeltaBadge({ percent, className }: { percent: number | null; className?: string }) {
  if (percent === null || !Number.isFinite(percent)) return null
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        percent >= 0 ? 'text-emerald-500' : 'text-red-500',
        className,
      )}
    >
      {percent >= 0 ? '▲' : '▼'} {Math.abs(percent).toFixed(1)}%
    </span>
  )
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export interface LegendItem {
  key: string
  label: string
  value?: string
  color: string
}

/**
 * Replaces recharts' `<Legend>`.
 *
 * The built-in one lays swatches in a row inside the SVG's width, so a Hebrew
 * customer name is ellipsised to nothing useful and the number that would make
 * the entry worth reading is not there at all. This is plain DOM: it wraps, it
 * carries the value, and clicking an entry isolates that series.
 */
export function ChartLegendChips({ items, isolated, onIsolate, className, title }: {
  items: LegendItem[]
  isolated?: string | null
  onIsolate?: (key: string | null) => void
  className?: string
  title?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      {items.map(item => {
        const dimmed = isolated != null && isolated !== item.key
        const content = (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate text-muted-foreground">{item.label}</span>
            {item.value && <span className="shrink-0 font-semibold tabular-nums">{item.value}</span>}
          </>
        )
        const classes = cn(
          'flex max-w-[220px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-opacity sm:text-sm',
          dimmed && 'opacity-40',
        )
        if (!onIsolate) return <span key={item.key} className={classes}>{content}</span>
        return (
          <button
            key={item.key}
            type="button"
            title={title}
            aria-pressed={isolated === item.key}
            onClick={() => onIsolate(isolated === item.key ? null : item.key)}
            className={cn(classes, 'hover:bg-accent')}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}

/** Shared isolate/hover state for a legend + its chart. */
export function useSeriesIsolation() {
  const [isolated, setIsolated] = useState<string | null>(null)
  const opacityFor = useCallback(
    (key: string) => (isolated == null || isolated === key ? 1 : 0.2),
    [isolated],
  )
  return { isolated, setIsolated, opacityFor }
}
