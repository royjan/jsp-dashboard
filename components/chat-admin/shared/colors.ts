// Shared color palette for admin dashboard components
// Enterprise SaaS design - clean, professional, muted colors

export type StatCardColor = 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'indigo' | 'gray' | 'neutral'

// Professional color scheme - flat solid colors only (no gradients).
// `iconGradient`/`textGradient`/`progressBar` keep their names for API stability
// but now hold a single solid class so nothing renders a gradient.
export const STAT_CARD_COLORS: Record<StatCardColor, {
  gradient: string
  border: string
  iconGradient: string
  textGradient: string
  hoverShadow: string
  progressBar: string
  // New: solid colors for cleaner look
  iconBg: string
  iconColor: string
  valueColor: string
}> = {
  blue: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-blue-500',
    iconBg: 'bg-blue-50 dark:bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
    textGradient: 'text-blue-600',
    valueColor: 'text-blue-600 dark:text-blue-400',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-blue-500'
  },
  green: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-emerald-500',
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    textGradient: 'text-emerald-600',
    valueColor: 'text-emerald-600 dark:text-emerald-400',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-emerald-500'
  },
  yellow: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-amber-500',
    iconBg: 'bg-amber-50 dark:bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-500',
    textGradient: 'text-amber-600',
    valueColor: 'text-amber-600 dark:text-amber-500',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-amber-500'
  },
  red: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-red-500',
    iconBg: 'bg-red-50 dark:bg-red-500/10',
    iconColor: 'text-red-600 dark:text-red-400',
    textGradient: 'text-red-600',
    valueColor: 'text-red-600 dark:text-red-400',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-red-500'
  },
  purple: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-violet-500',
    iconBg: 'bg-violet-50 dark:bg-violet-500/10',
    iconColor: 'text-violet-600 dark:text-violet-400',
    textGradient: 'text-violet-600',
    valueColor: 'text-violet-600 dark:text-violet-400',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-violet-500'
  },
  indigo: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-indigo-500',
    iconBg: 'bg-indigo-50 dark:bg-indigo-500/10',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    textGradient: 'text-indigo-600',
    valueColor: 'text-indigo-600 dark:text-indigo-400',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-indigo-500'
  },
  gray: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-slate-500',
    iconBg: 'bg-slate-100 dark:bg-slate-600/15',
    iconColor: 'text-slate-600 dark:text-slate-400',
    textGradient: 'text-slate-600',
    valueColor: 'text-slate-700 dark:text-slate-300',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-slate-500'
  },
  // Neutral - for generic stats that don't need color coding
  neutral: {
    gradient: 'bg-card',
    border: 'border-border',
    iconGradient: 'bg-slate-400',
    iconBg: 'bg-slate-100 dark:bg-slate-600/15',
    iconColor: 'text-slate-500 dark:text-slate-400',
    textGradient: 'text-slate-700',
    valueColor: 'text-slate-800 dark:text-slate-200',
    hoverShadow: 'hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20',
    progressBar: 'bg-slate-500'
  }
}

// Status badge colors - consistent across all components
export const STATUS_COLORS = {
  healthy: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
    dot: 'bg-emerald-500'
  },
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
    dot: 'bg-emerald-500'
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    dot: 'bg-amber-500'
  },
  degraded: {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    dot: 'bg-amber-500'
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    dot: 'bg-red-500'
  },
  down: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    dot: 'bg-red-500'
  },
  pending: {
    bg: 'bg-muted',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
    dot: 'bg-slate-400'
  },
  unknown: {
    bg: 'bg-muted',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
    dot: 'bg-slate-400'
  },
  busy: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    dot: 'bg-blue-500'
  },
  active: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    dot: 'bg-blue-500'
  }
} as const

export type StatusType = keyof typeof STATUS_COLORS
