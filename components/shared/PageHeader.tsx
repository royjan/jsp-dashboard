'use client'

/**
 * <PageHeader> — the one page title block.
 *
 * Before this, 27 of 63 pages hand-rolled an <h1> (some `text-xl sm:text-2xl`,
 * some `text-2xl`, some with an icon, some with a subtitle) and the rest had no
 * heading at all. Restyling "the page title" meant 27 edits and a guess about
 * the other 36.
 *
 * RTL: uses logical properties only, so the icon and actions land on the
 * correct side under both dir="rtl" and dir="ltr".
 */

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  /** The page title. Keep it short — it is the h1. */
  title: React.ReactNode
  /** One line of context under the title. Optional. */
  description?: React.ReactNode
  /** Leading icon, rendered in a tinted square. Optional. */
  icon?: LucideIcon
  /**
   * Right-aligned (logical end) controls — period selectors, export buttons,
   * refresh. Wraps below the title on narrow screens instead of squashing it.
   */
  actions?: React.ReactNode
  /** Extra content below the header (filter bars, tabs). */
  children?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export default PageHeader
