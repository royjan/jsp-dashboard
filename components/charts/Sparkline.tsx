'use client'

/**
 * Sparkline — a tiny inline trend, deliberately NOT recharts.
 *
 * KPI cards render four of these above the fold; a ResponsiveContainer each
 * would mount four ResizeObservers and re-layout on every card resize for a
 * 40px graphic. This is one <svg> with two paths and no layout measurement.
 *
 * Values are plotted as-is: no axis, no ticks, no tooltip. It answers
 * "which way, how bumpy" — the number beside it answers "how much".
 */
export function Sparkline({
  data,
  color = 'var(--primary)',
  width = 96,
  height = 28,
  className,
  title,
}: {
  data: number[]
  color?: string
  width?: number
  height?: number
  className?: string
  title?: string
}) {
  if (data.length < 2) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  // A flat series would divide by zero; draw it as a mid-height line instead.
  const span = max - min || 1
  const stepX = width / (data.length - 1)
  // 1px inset top and bottom so the stroke is not clipped at the extremes.
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2)

  const points = data.map((v, i) => `${(i * stepX).toFixed(2)},${y(v).toFixed(2)}`)
  const line = `M${points.join('L')}`
  const area = `${line}L${width},${height}L0,${height}Z`
  const gradientId = `spark-${Math.round(width)}-${data.length}-${Math.round(max)}`
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
