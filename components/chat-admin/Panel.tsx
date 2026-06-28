'use client'

import React from 'react'

interface PanelProps {
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/** DRY wrapper for dashboard sections — dark elevated card with an optional header row. */
export function Panel({ title, subtitle, icon, action, className = '', children }: PanelProps) {
  return (
    <div className={`rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary,#e7e7ea)]">
                {icon}
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-[var(--color-text-tertiary,#8a8a90)]">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export default Panel
