'use client'

/**
 * "Where did this number come from?" — one chip, next to the figure.
 *
 * Sits in PageHeader's actions by default, so a page adopts it by passing one
 * prop rather than by editing its layout.
 *
 * The colours mean coverage, not prettiness:
 *   green  — live, complete
 *   amber  — cached, a sample, or a deliberate subset: real but not the whole story
 *   red    — the source could not answer, or the answer is known to be capped
 *
 * A red chip is the important one. It is the difference between "we sold
 * nothing" and "we could not see the sales", which every other part of this app
 * renders identically as 0.
 */

import * as React from 'react'
import { Database, AlertTriangle, Clock, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type Provenance,
  freshnessOf,
  hebrewAge,
  SOURCE_LABEL_HE,
} from '@/lib/provenance'
import { formatNumber } from '@/lib/format'

export interface FreshnessChipProps {
  provenance?: Provenance | null
  className?: string
}

export function FreshnessChip({ provenance, className }: FreshnessChipProps) {
  const [open, setOpen] = React.useState(false)
  if (!provenance) return null

  const { source, rows, truncated, scope, reason, asOf } = provenance
  const fresh = freshnessOf(provenance)
  const unavailable = source === 'unavailable'
  const problem = unavailable || truncated === true

  const tone = problem
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : fresh === 'live'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'

  const Icon = problem ? AlertTriangle : source === 'redis' ? Clock : scope ? Layers : Database

  // The short label answers "can I read this at face value"; the detail answers
  // "why not". Anything longer than a few words in the chip itself gets ignored.
  const label = unavailable
    ? SOURCE_LABEL_HE.unavailable
    : truncated
      ? 'תוצאה חתוכה'
      : scope
        ? 'מדגם'
        : (hebrewAge(asOf) ?? SOURCE_LABEL_HE[source])

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
          tone,
        )}
      >
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </button>

      {open && (
        <div
          className="absolute inset-inline-end-0 z-30 mt-1.5 w-64 rounded-lg border bg-card p-3 text-xs shadow-lg"
          style={{ insetInlineEnd: 0 }}
        >
          <dl className="space-y-1.5">
            <Row term="מקור" desc={SOURCE_LABEL_HE[source]} />
            {asOf && <Row term="נכון ל" desc={hebrewAge(asOf) ?? asOf} />}
            {typeof rows === 'number' && <Row term="שורות" desc={formatNumber(rows)} />}
            {scope && <Row term="היקף" desc={scope} />}
            {truncated && (
              <Row
                term="שים לב"
                desc="התוצאה נחתכה בתקרה — המספר הוא רצפה, לא סכום."
                emphasis
              />
            )}
            {reason && <Row term="סיבה" desc={reason} emphasis />}
          </dl>
        </div>
      )}
    </div>
  )
}

function Row({ term, desc, emphasis }: { term: string; desc: string; emphasis?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{term}</dt>
      <dd className={cn('min-w-0 flex-1 text-end', emphasis ? 'font-medium text-destructive' : 'text-foreground')}>
        {desc}
      </dd>
    </div>
  )
}

export default FreshnessChip
