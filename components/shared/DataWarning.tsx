'use client'

/**
 * "Part of this screen could not be loaded."
 *
 * The business-report route has collected `query_failures` for a while and the
 * UI never rendered it, so a query that failed showed up as a zero on a revenue
 * card and nothing else. On this dataset that is the dangerous failure: an
 * empty result and a genuinely quiet month look identical, and the empty one is
 * the more believable of the two.
 *
 * Deliberately a warning strip and not an error state — the rest of the page IS
 * valid and worth reading. What must not happen is the reader taking the broken
 * part for a real number.
 */

import * as React from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DataWarningProps {
  /** One line per thing that failed. Empty/undefined renders nothing. */
  failures?: string[] | null
  /** What the reader should take away. */
  title?: string
  className?: string
}

export function DataWarning({ failures, title, className }: DataWarningProps) {
  const [open, setOpen] = React.useState(false)
  if (!failures || failures.length === 0) return null

  const heading =
    title ?? `חלק מהנתונים במסך הזה לא נטענו (${failures.length})`

  return (
    <div
      role="status"
      className={cn(
        'rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{heading}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            המספרים שמושפעים מהשאילתות האלה מוצגים כאפס — הם לא אפס אמיתי.
          </p>

          {open && (
            <ul className="mt-2 space-y-1" dir="ltr">
              {failures.map((f, i) => (
                <li
                  key={i}
                  className="rounded-md bg-background/60 px-2 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground"
                >
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={open}
          aria-label={open ? 'הסתר פרטים' : 'הצג פרטים'}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
    </div>
  )
}

export default DataWarning
