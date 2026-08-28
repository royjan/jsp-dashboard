'use client'

import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * "Open in Xpart" — the escape hatch off a read-only screen.
 *
 * Always a new tab: the dashboard and Xpart are separate apps behind separate
 * logins, and navigating away mid-review to a login screen loses the place you
 * were in.
 */
export function XpartLink({
  href,
  label,
  className,
}: {
  href: string
  label?: string
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground',
        'transition-colors hover:border-primary/50 hover:text-foreground',
        className,
      )}
    >
      <ExternalLink className="h-3 w-3" />
      {label ?? 'Xpart'}
    </a>
  )
}
