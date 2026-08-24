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
import { CartesianGrid, Sector, type PieSectorDataItem } from 'recharts'
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

/**
 * Bar thickness ceiling.
 *
 * Recharts divides the axis between however many categories it was given, so a
 * chart with one or two rows drew a bar as tall as the card — /receivables with
 * a single late customer was a 300px red slab, which reads as a filled panel,
 * not as a measurement. A ceiling keeps a 1-row and a 10-row chart the same
 * shape; there is no floor to add, since recharts already grows the plot.
 */
export const BAR_MAX = 28

/** Bars: one rounded end, pointing the way the bar grows. */
export const BAR_RADIUS = {
  vertical: [4, 4, 0, 0] as [number, number, number, number],
  /** Horizontal bars in an RTL page still grow left→right in the SVG. */
  horizontal: [0, 4, 4, 0] as [number, number, number, number],
}

// ---------------------------------------------------------------------------
// Hover feedback
// ---------------------------------------------------------------------------

/*
 * The charts animated on entry and then went inert: the tooltip was the only
 * thing that acknowledged the pointer, and on a dense bar chart it names a row
 * without telling you WHICH bar it read. These three give the mark under the
 * cursor its own response.
 *
 * All three are driven by recharts' own active index — the same one the tooltip
 * uses — so they cost no state, no handlers and no re-render of the page.
 *
 * They are hover STATES, not transitions: nothing travels, so there is no
 * reduced-motion hazard to gate. (Entry animation is a separate concern; see
 * ANIM, which every chart already spreads.)
 */

/** Bars: the hovered one comes to full strength and takes a thin outline. */
export const ACTIVE_BAR = {
  fillOpacity: 1,
  stroke: 'var(--foreground)',
  strokeOpacity: 0.4,
  strokeWidth: 1,
} as const

/** Lines/areas: the dot on the hovered point, sized to be findable. */
export const ACTIVE_DOT = {
  r: 5,
  strokeWidth: 2,
  stroke: 'var(--card)',
} as const

/**
 * Pie/donut: the hovered slice grows outward from the same centre.
 *
 * Growing only the OUTER radius is deliberate — pushing the whole sector out
 * along its bisector (the usual "exploded pie") breaks the ring, and on a donut
 * carrying a centred total it drags the eye off the number.
 *
 * Pass as `activeShape={ActivePieSector}`.
 */
export function ActivePieSector({ outerRadius = 0, ...rest }: PieSectorDataItem) {
  return <Sector {...rest} outerRadius={outerRadius + 6} />
}

// ---------------------------------------------------------------------------
// Pie / donut
// ---------------------------------------------------------------------------

/**
 * The total that belongs in the hole of a donut.
 *
 * It used to be two SVG `<text>` nodes inside `<PieChart>`. SVG text does not
 * wrap and does not shrink, so ₪43,052,935 was laid out straight through the
 * ring on both sides and the reader saw "43,052,93" with the ends painted over
 * by the slices. This is DOM on top of the chart instead: it centres on the
 * container, steps its size down as the number gets longer, and cannot be
 * overpainted.
 *
 * Wrap the chart in `relative` and give the `<Pie>` no `<Legend>` — a legend
 * inside the SVG shrinks the plot upward and the hole stops being the centre of
 * the box. Use `<ChartLegendChips>` underneath instead.
 */
export function DonutCenter({ value, label, className }: {
  value: string
  label?: string
  className?: string
}) {
  const size = value.length > 13 ? 'text-xs' : value.length > 10 ? 'text-sm' : 'text-base'
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-2 text-center',
        className,
      )}
    >
      <span className={cn('font-bold leading-none tabular-nums', size)}>{value}</span>
      {label && <span className="text-[10px] leading-tight text-muted-foreground">{label}</span>}
    </div>
  )
}

/**
 * Sector separation for every `<Pie>`. The white seam recharts hard-codes is
 * neutralised in globals.css; this adds the small gap that makes neighbouring
 * slices legible without a rule between them.
 */
export const PIE_PROPS = {
  paddingAngle: 2,
  minAngle: 2,
} as const

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

/* ────────────────────────────────────────────────────────────────────────────
 * The frame: card, gradients, range switcher, sparkline.
 *
 * Added for הנהח״ש, but deliberately generic — a figure anywhere in the
 * dashboard gets the same header (title, hero value, delta), the same gradient
 * area fill, and the same range control, so charts read as one system instead
 * of one-offs.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Gradient fills for area charts. Render once inside <defs>, then reference
 *  `fill={`url(#${gradientId(key)})`}`. */
export function gradientId(key: string) {
  return `books-grad-${key}`
}

export function GradientDefs({ series }: { series: Array<{ key: string; color: string }> }) {
  return (
    <defs>
      {series.map((s) => (
        <linearGradient key={s.key} id={gradientId(s.key)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
        </linearGradient>
      ))}
    </defs>
  )
}

export interface ChartCardProps {
  title: string
  /** The one number the chart is about — rendered large, already formatted. */
  value?: string
  hint?: string
  /** Percent change beside the value; pass null to hide. */
  changePercent?: number | null
  actions?: React.ReactNode
  legend?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/** A chart with its title, hero figure and legend in one frame. */
export function ChartCard({
  title, value, hint, changePercent, actions, legend, footer, className, children,
}: ChartCardProps) {
  return (
    <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-3 pb-1 sm:p-4 sm:pb-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
            {changePercent != null && <DeltaBadge percent={changePercent} />}
          </div>
          {value && (
            <div className="mt-0.5 text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
          )}
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      <div className="px-1 pb-2 sm:px-2">{children}</div>
      {(legend || footer) && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 sm:px-4">
          {legend}
          {footer && <div className="ms-auto text-xs text-muted-foreground">{footer}</div>}
        </div>
      )}
    </div>
  )
}

export interface ChartRangeOption<V extends string = string> {
  value: V
  label: string
}

/** The range switcher above a time series (3 חודשים / 6 / שנה / הכל). */
export function ChartRange<V extends string>({ value, options, onChange }: {
  value: V
  options: ChartRangeOption<V>[]
  onChange: (value: V) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-2 py-1 text-xs transition-colors pointer-coarse:min-h-9',
            value === option.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A row-sized area chart — the shape of one account's movement, inline in a
 * table cell. Deliberately axis-less and tooltip-less: it is a glyph, and the
 * numbers next to it are the data.
 */
export function Sparkline({ points, color = 'var(--primary)', width = 72, height = 20 }: {
  points: number[]
  color?: string
  width?: number
  height?: number
}) {
  if (points.length < 2) return <span className="inline-block" style={{ width, height }} />
  const min = Math.min(...points, 0)
  const max = Math.max(...points, 0)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const y = (v: number) => height - ((v - min) / span) * height
  const line = points.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const zero = y(0)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
         className="inline-block align-middle overflow-visible" aria-hidden="true">
      <polygon points={`0,${zero} ${line} ${width},${zero}`} fill={color} fillOpacity={0.14} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5}
                strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
