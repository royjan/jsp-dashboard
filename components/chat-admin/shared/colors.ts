// Shared color palette for admin dashboard components
// Enterprise SaaS design - clean, professional, muted colors

export type StatCardColor = 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'indigo' | 'gray' | 'neutral'

// Professional color scheme - semantic colors only for status, neutral for most UI
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
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-blue-500/15',
    iconGradient: 'from-blue-500 to-blue-600',
    iconBg: 'bg-blue-50 dark:bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
    textGradient: 'from-blue-600 to-blue-700',
    valueColor: 'text-blue-600 dark:text-blue-400',
    hoverShadow: 'hover:shadow-lg hover:shadow-blue-500/10 dark:hover:shadow-blue-500/10',
    progressBar: 'from-blue-500 to-blue-600'
  },
  green: {
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-emerald-500/15',
    iconGradient: 'from-emerald-500 to-emerald-600',
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    textGradient: 'from-emerald-600 to-emerald-700',
    valueColor: 'text-emerald-600 dark:text-emerald-400',
    hoverShadow: 'hover:shadow-lg hover:shadow-emerald-500/10 dark:hover:shadow-emerald-500/10',
    progressBar: 'from-emerald-500 to-emerald-600'
  },
  yellow: {
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-amber-500/15',
    iconGradient: 'from-amber-500 to-amber-600',
    iconBg: 'bg-amber-50 dark:bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-500',
    textGradient: 'from-amber-600 to-amber-700',
    valueColor: 'text-amber-600 dark:text-amber-500',
    hoverShadow: 'hover:shadow-lg hover:shadow-amber-500/10 dark:hover:shadow-amber-500/10',
    progressBar: 'from-amber-500 to-amber-600'
  },
  red: {
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-red-500/15',
    iconGradient: 'from-red-500 to-red-600',
    iconBg: 'bg-red-50 dark:bg-red-500/10',
    iconColor: 'text-red-600 dark:text-red-400',
    textGradient: 'from-red-600 to-red-700',
    valueColor: 'text-red-600 dark:text-red-400',
    hoverShadow: 'hover:shadow-lg hover:shadow-red-500/10 dark:hover:shadow-red-500/10',
    progressBar: 'from-red-500 to-red-600'
  },
  purple: {
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-violet-500/15',
    iconGradient: 'from-violet-500 to-violet-600',
    iconBg: 'bg-violet-50 dark:bg-violet-500/10',
    iconColor: 'text-violet-600 dark:text-violet-400',
    textGradient: 'from-violet-600 to-violet-700',
    valueColor: 'text-violet-600 dark:text-violet-400',
    hoverShadow: 'hover:shadow-lg hover:shadow-violet-500/10 dark:hover:shadow-violet-500/10',
    progressBar: 'from-violet-500 to-violet-600'
  },
  indigo: {
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-indigo-500/15',
    iconGradient: 'from-indigo-500 to-indigo-600',
    iconBg: 'bg-indigo-50 dark:bg-indigo-500/10',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    textGradient: 'from-indigo-600 to-indigo-700',
    valueColor: 'text-indigo-600 dark:text-indigo-400',
    hoverShadow: 'hover:shadow-lg hover:shadow-indigo-500/10 dark:hover:shadow-indigo-500/10',
    progressBar: 'from-indigo-500 to-indigo-600'
  },
  gray: {
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-slate-600/20',
    iconGradient: 'from-slate-500 to-slate-600',
    iconBg: 'bg-slate-100 dark:bg-slate-600/15',
    iconColor: 'text-slate-600 dark:text-slate-400',
    textGradient: 'from-slate-600 to-slate-700',
    valueColor: 'text-slate-700 dark:text-slate-300',
    hoverShadow: 'hover:shadow-lg hover:shadow-slate-500/10 dark:hover:shadow-slate-500/10',
    progressBar: 'from-slate-500 to-slate-600'
  },
  // Neutral - for generic stats that don't need color coding
  neutral: {
    gradient: 'bg-white/80 dark:bg-slate-800/40 backdrop-blur-sm',
    border: 'border-slate-200/80 dark:border-slate-600/20',
    iconGradient: 'from-slate-400 to-slate-500',
    iconBg: 'bg-slate-100 dark:bg-slate-600/15',
    iconColor: 'text-slate-500 dark:text-slate-400',
    textGradient: 'from-slate-700 to-slate-800',
    valueColor: 'text-slate-800 dark:text-slate-200',
    hoverShadow: 'hover:shadow-lg hover:shadow-slate-500/10 dark:hover:shadow-slate-500/10',
    progressBar: 'from-slate-400 to-slate-500'
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
    bg: 'bg-slate-50 dark:bg-slate-800/50',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
    dot: 'bg-slate-400'
  },
  unknown: {
    bg: 'bg-slate-50 dark:bg-slate-800/50',
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
