/**
 * Shared data-viz colors so the same kind of series gets the same color across pages.
 *
 * - CHART_PALETTE: categorical scale for multi-series / by-entity charts.
 * - CHART_SEMANTIC: good → warn → bad (gauges, status, aging severity).
 *
 * (Chart axis/grid/text colors are themed via the Recharts overrides in globals.css.)
 */
export const CHART_PALETTE = [
  '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb7185',
  '#fb923c', '#38bdf8', '#4ade80', '#e879f9', '#f87171',
] as const

export const CHART_SEMANTIC = {
  good: '#34d399',
  warn: '#fbbf24',
  bad: '#f87171',
} as const

/** good → warn → bad as an ordered array (e.g. gauge thresholds). */
export const CHART_SEMANTIC_SCALE = [CHART_SEMANTIC.good, CHART_SEMANTIC.warn, CHART_SEMANTIC.bad] as const
