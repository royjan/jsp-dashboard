/**
 * Shared data-viz colors so the same kind of series gets the same color across pages.
 *
 * - CHART_PALETTE: categorical scale for multi-series / by-entity charts.
 * - CHART_SEMANTIC: good → warn → bad (gauges, status, aging severity).
 *
 * These are `var(--…)` references, not hex. That is the point: the palette used
 * to be a literal JS array, and a JS array cannot vary by theme — every value
 * was a Tailwind -400 step chosen for the dark surface, so on the white card all
 * six series fell below 3:1 contrast. It went unnoticed because defaultTheme is
 * "dark". The steps now live in app/globals.css under :root and .dark, same six
 * hues per theme, and were checked with the dataviz validate_palette.js against
 * this app's real surfaces (#ffffff / #171b22).
 *
 * Recharts accepts CSS custom properties anywhere it takes a color, so these
 * drop straight into fill/stroke. Do NOT wrap them in hsl() — the tokens are
 * hex, and hsl(var(--x)) yields an invalid color that renders no mark at all.
 *
 * (Chart axis/grid/text colors are themed via the Recharts overrides in globals.css.)
 */
export const CHART_PALETTE = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
] as const

/**
 * Categorical slots are assigned in fixed order and never cycled: a 7th series
 * must fold into an "other" bucket rather than reuse slot 1, otherwise two
 * different entities share a color. Use this instead of `PALETTE[i % len]`.
 */
export function seriesColor(index: number): string {
  return CHART_PALETTE[index] ?? 'var(--muted-foreground)'
}

/** True when a series index has no distinct slot left and belongs in "other". */
export function isOverflowSeries(index: number): boolean {
  return index >= CHART_PALETTE.length
}

export const CHART_SEMANTIC = {
  good: 'var(--success)',
  warn: 'var(--warning)',
  bad: 'var(--destructive)',
} as const

/** good → warn → bad as an ordered array (e.g. gauge thresholds). */
export const CHART_SEMANTIC_SCALE = [CHART_SEMANTIC.good, CHART_SEMANTIC.warn, CHART_SEMANTIC.bad] as const
