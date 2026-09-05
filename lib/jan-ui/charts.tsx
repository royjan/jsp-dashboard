'use client'

/**
 * Sparkline and AxisChart — two sizes of the same honesty problem.
 *
 * The overview screen's 30-day sales chart has NO Y AXIS. It draws a handsome
 * curve, labels one point "שיא 17.8", and leaves every other value unreadable.
 * Its x labels are `6.8 · 7.8 · 9.8`, which are dates and read as decimals.
 *
 * So: <AxisChart> always draws the scale, and every tick names a value the
 * chart actually reaches. <Sparkline> draws no scale at all — it is a shape, not
 * a reading, and it belongs inside a tile where the FIGURE carries the number.
 * The distinction is the point. A chart that is somewhere between the two, with
 * a suggestive curve and no way to read it, is the thing being replaced.
 */

import * as React from 'react'
import { cn } from './cn'

const path = (vals: number[], w: number, h: number, min: number, max: number) => {
  const rng = max - min || 1
  const step = vals.length > 1 ? w / (vals.length - 1) : 0
  return vals
    .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)} ${(h - ((v - min) / rng) * h).toFixed(2)}`)
    .join(' ')
}

/**
 * Draws a path on once, when it first comes into view, by running its own dash
 * offset to zero.
 *
 * ALWAYS LEFT TO RIGHT, even in an RTL app. The x axis is time, and time only
 * goes one way; mirroring the draw to match the reading direction would show the
 * line growing backwards out of the newest value.
 *
 * Returns nothing to animate under `prefers-reduced-motion` — the path is simply
 * already there, which is the correct final state and not a degraded one.
 */
function useDrawOn(enabled: boolean) {
  const ref = React.useRef<SVGPathElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const len = el.getTotalLength()
    if (!len) return
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (!e.isIntersecting) return
        el.animate(
          [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: 1100, easing: 'cubic-bezier(.25,.46,.45,.94)', fill: 'forwards' },
        )
        io.disconnect()
      })
    }, { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])
  return ref
}

export interface SparklineProps {
  values: number[]
  /** Direction sets the hue: the trend, never the reading. */
  tone?: 'auto' | 'good' | 'bad' | 'neutral'
  height?: number
  /** Draw the line on when it first appears. Off inside a busy table. */
  draw?: boolean
  className?: string
}

export function Sparkline({ values, tone = 'auto', height = 30, draw = false, className }: SparklineProps) {
  if (!values || values.length < 2) return null
  const W = 120
  const min = Math.min(...values), max = Math.max(...values)
  const rising = values[values.length - 1] >= values[0]
  const resolved = tone === 'auto' ? (rising ? 'good' : 'bad') : tone
  const stroke =
    resolved === 'good' ? 'var(--jan-verdigris)'
    : resolved === 'bad' ? 'var(--jan-oxide)'
    : 'var(--jan-dim)'
  const lastY = height - ((values[values.length - 1] - min) / (max - min || 1)) * height
  const line = useDrawOn(draw)

  return (
    <svg
      viewBox={`0 0 ${W} ${height + 4}`}
      preserveAspectRatio="none"
      className={cn('block w-full', className)}
      style={{ height }}
      aria-hidden="true"
      focusable="false"
    >
      <path ref={line} d={path(values, W, height, min, max)} fill="none" stroke={stroke}
            strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* The endpoint is where the eye goes, so it is the one mark given weight. */}
      <circle cx={W} cy={lastY} r={2.6} fill={stroke} />
    </svg>
  )
}

export interface AxisChartSeries {
  values: number[]
  label: string
  /** The muted comparison line rather than the subject. */
  compare?: boolean
}

export interface AxisChartProps {
  series: AxisChartSeries[]
  /** One label per x tick. Write dates as people say them: '6 באוג', not '6.8'. */
  xLabels: string[]
  /** Formats the y ticks — units, currency, thousands. */
  formatY?: (n: number) => string
  height?: number
  /** Accessible summary; without it the chart is invisible to a screen reader. */
  caption: string
  className?: string
}

const niceCeil = (n: number) => {
  if (n <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(n)))
  return Math.ceil(n / mag) * mag
}

export function AxisChart({
  series, xLabels, formatY = String, height = 220, caption, className,
}: AxisChartProps) {
  const subject = series.find(s => !s.compare) ?? series[0]
  if (!subject || subject.values.length < 2) return null

  const W = 640
  const padL = 48, padR = 10, padT = 14, padB = 30
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = height - padB
  const plotW = x1 - x0, plotH = y1 - y0

  const all = series.flatMap(s => s.values)
  const max = niceCeil(Math.max(...all, 0))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(max * f))

  const lastY = y1 - (subject.values[subject.values.length - 1] / (max || 1)) * plotH
  const last = subject.values[subject.values.length - 1]

  return (
    <figure className={cn('m-0', className)}>
      <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" role="img" aria-label={caption}>
        {ticks.map(t => {
          const y = y1 - (t / (max || 1)) * plotH
          return (
            <g key={t}>
              <line x1={x0} x2={x1} y1={y} y2={y}
                    stroke="var(--jan-rule)" strokeWidth={1} strokeDasharray="2 4" />
              {/* Anchored 'end' and inside the viewBox, so the widest label is
                  not clipped by the left edge. */}
              <text x={x0 - 8} y={y + 3.5} textAnchor="end"
                    className="font-mono" style={{ fontSize: 10, fill: 'var(--jan-dim)' }}>
                {formatY(t)}
              </text>
            </g>
          )
        })}
        <line x1={x0} x2={x0} y1={y0} y2={y1} stroke="var(--jan-rule)" strokeWidth={1} />

        {series.map((s, i) => (
          <path
            key={i}
            d={path(s.values, plotW, plotH, 0, max)}
            transform={`translate(${x0} ${y0})`}
            fill="none"
            stroke={s.compare ? 'var(--jan-faint)' : 'var(--jan-callout)'}
            strokeWidth={s.compare ? 1.4 : 2}
            strokeDasharray={s.compare ? '4 3' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        <circle cx={x1} cy={lastY} r={6} fill="none" stroke="var(--jan-callout)"
                strokeWidth={1.5} opacity={0.35} />
        <circle cx={x1} cy={lastY} r={3.2} fill="var(--jan-callout)" />

        {xLabels.map((l, i) => (
          <text key={i}
                x={x0 + (i / Math.max(xLabels.length - 1, 1)) * plotW}
                y={y1 + 18}
                textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
                style={{ fontSize: 10.5, fill: 'var(--jan-dim)' }}>
            {l}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2.5 flex flex-wrap gap-4 text-[12.5px] text-[var(--jan-dim)]">
        {series.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-3.5 rounded-full"
                  style={{ background: s.compare ? 'var(--jan-faint)' : 'var(--jan-callout)' }} />
            {s.label}
          </span>
        ))}
        <span className="text-[var(--jan-faint)]">אחרון: {formatY(last)}</span>
      </figcaption>
    </figure>
  )
}
