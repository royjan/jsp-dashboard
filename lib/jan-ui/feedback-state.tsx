'use client'

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { cn } from './cn'

/**
 * Shared load-failure and empty states so every page handles them the same way
 * (Hebrew-first, icon + message + optional retry). Use ErrorState in a query's
 * `isError` branch and EmptyState when a successful query returns nothing.
 */

/**
 * `variant` controls the chrome, not the content:
 *  - 'card'   → bordered surface. Use when the state REPLACES a card/section.
 *  - 'inline' → no border or background. Use when it already sits inside a
 *               card or a <td>, where a second border reads as a nested box.
 */
export type FeedbackVariant = 'card' | 'inline'

interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  variant?: FeedbackVariant
  className?: string
}

export function ErrorState({
  title = 'משהו השתבש',
  description = 'לא הצלחנו לטעון את הנתונים. נסה שוב.',
  onRetry,
  retryLabel = 'נסה שוב',
  variant = 'card',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        variant === 'card'
          ? 'rounded-xl border border-border bg-card px-6 py-12'
          : 'px-4 py-10',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1 gap-1.5">
          <RefreshCw className="h-4 w-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  variant?: FeedbackVariant
  className?: string
}

export function EmptyState({
  title = 'אין נתונים להצגה',
  description,
  icon,
  action,
  variant = 'card',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        variant === 'card'
          ? 'rounded-xl border border-dashed border-border bg-card/50 px-6 py-12'
          : 'px-4 py-10',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
