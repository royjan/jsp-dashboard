'use client'

import React from 'react'
import { STATUS_COLORS, type StatusType } from './colors'
import { CheckCircle, AlertTriangle, XCircle, Clock, HelpCircle, Loader2 } from 'lucide-react'

interface StatusBadgeProps {
  status: StatusType | string
  label?: string
  showIcon?: boolean
  showDot?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  healthy: CheckCircle,
  success: CheckCircle,
  warning: AlertTriangle,
  degraded: AlertTriangle,
  error: XCircle,
  down: XCircle,
  pending: Clock,
  unknown: HelpCircle,
  busy: Loader2,
  active: Loader2,
}

const STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  success: 'Success',
  warning: 'Warning',
  degraded: 'Degraded',
  error: 'Error',
  down: 'Down',
  pending: 'Pending',
  unknown: 'Unknown',
  busy: 'Busy',
  active: 'Active',
}

const SIZE_CLASSES = {
  sm: {
    badge: 'px-2 py-0.5 text-xs gap-1',
    icon: 'w-3 h-3',
    dot: 'w-1.5 h-1.5'
  },
  md: {
    badge: 'px-2.5 py-1 text-xs gap-1.5',
    icon: 'w-3.5 h-3.5',
    dot: 'w-2 h-2'
  },
  lg: {
    badge: 'px-3 py-1.5 text-sm gap-2',
    icon: 'w-4 h-4',
    dot: 'w-2.5 h-2.5'
  }
}

export function StatusBadge({
  status,
  label,
  showIcon = true,
  showDot = false,
  size = 'md',
  className = ''
}: StatusBadgeProps) {
  // Normalize status to lowercase and map to known status
  const normalizedStatus = status.toLowerCase() as StatusType
  const colors = STATUS_COLORS[normalizedStatus] || STATUS_COLORS.unknown
  const Icon = STATUS_ICONS[normalizedStatus] || HelpCircle
  const displayLabel = label || STATUS_LABELS[normalizedStatus] || status
  const sizeClasses = SIZE_CLASSES[size]

  return (
    <span
      className={`
        inline-flex items-center
        ${sizeClasses.badge}
        ${colors.bg}
        ${colors.text}
        border ${colors.border}
        rounded-full
        font-medium
        whitespace-nowrap
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {showDot && !showIcon && (
        <span className={`${sizeClasses.dot} ${colors.dot} rounded-full`} />
      )}
      {showIcon && (
        <Icon className={`${sizeClasses.icon} ${normalizedStatus === 'busy' || normalizedStatus === 'active' ? 'animate-spin' : ''}`} />
      )}
      {displayLabel}
    </span>
  )
}

export default StatusBadge
