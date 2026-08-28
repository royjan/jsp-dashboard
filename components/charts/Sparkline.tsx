'use client'

import { useId } from 'react'

/**
 * Sparkline — a tiny inline trend, deliberately NOT recharts.
 *
 * KPI cards render four of these above the fold; a ResponsiveContainer each
 * would mount four ResizeObservers and re-layout on every card resize for a
 * 40px graphic. This is one <svg> with two paths and no layout measurement.
 *
 * Values are plotted as-is: no axis, no ticks, no tooltip. It answers
 * "which way, how bumpy" — the number beside it answers "how much".
 *
 * `baseline` is why there is one of these and not two. A second copy lived in
 * kit.tsx taking `points` instead of `data`, and the difference that mattered
 * was not the prop name: it anchored the fill to zero rather than to the lowest
 * value, which is the correct reading for a balance that can cross zero and the
 * wrong one for a series that never approaches it. Both live here as an option
 * rather than as two components sharing a name and disagreeing.
 */
export function Sparkline({
  data,
  color = 'var(--primary)',
  width = 96,
  height = 28,
  className,
  title,
  baseline = 'min',
}: {
  data: number[]
  color?: string
  width?: number
  height?: number
  className?: string
  title?: string
  /**
   * 'min' fills from the lowest value — best for a series that never nears
   * zero, where anchoring there would flatten the shape into nothing.
   * 'zero' keeps zero on the scale, so a balance crossing it reads correctly.
   */
  baseline?: 'min' | 'zero'
}) {
  // Hooks run before the early return: a component may not change hook count
  // between renders, and a series can shrink below two points at runtime.
  const gradientId = useId()

  if (data.length < 2) return null

  const max = baseline === 'zero' ? Math.max(...data, 0) : Math.max(...data)
  const min = baseline === 'zero' ? Math.min(...data, 0) : Math.min(...data)
  // A flat series would divide by zero; draw it as a mid-height line instead.
  const span = max - min || 1
  const stepX = width / (data.length - 1)
  // 1px inset top and bottom so the stroke is not clipped at the extremes.
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2)

  const points = data.map((v, i) => `${(i * stepX).toFixed(2)},${y(v).toFixed(2)}`)
  const line = `M${points.join('L')}`
  // Close the fill on the baseline rather than the bottom edge, so a
  // zero-anchored series shows area above and below the axis.
  const floor = baseline === 'zero' ? y(0) : height
  const area = `${line}L${width},${floor}L0,${floor}Z`
  const last = data[data.length - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      // The card already carries the label; the sparkline is decoration to a
      // screen reader, not a second unlabelled figure to announce.
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={width} cy={y(last)} r={2} fill={color} />
    </svg>
  )
}
