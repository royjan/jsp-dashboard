'use client'

/**
 * Whether the part is on the shelf — the one fact that closes or loses a sale.
 *
 * Diego renders it today as `10.5px` `--jan-faint` text, glued into a run with
 * five other fields, and produces the sentence `במלאי אין במלאי` — the label and
 * the value both being the word "stock". On a six-row answer where two parts are
 * actually in stock, nothing on the screen distinguishes those two rows.
 *
 * Three states, not two. `null` quantity is UNKNOWN and gets its own treatment,
 * because a catalogue row the warehouse has never counted is a different answer
 * from one counted at zero — and collapsing them is how "אין במלאי" ends up on a
 * part that is sitting on a shelf. See `stockState` in values.ts.
 *
 * The quantity is the whole point of the 'in' state, so it is not optional
 * chrome: a pill that says only "במלאי" makes the counter clerk ask a second
 * question.
 */

import { cn } from './cn'
import { stockState, type StockState } from './values'

export interface StockPillProps {
  /** Units on hand. `null`/`undefined` means NOT COUNTED, not zero. */
  qty: number | null | undefined
  /** Bin location, e.g. 'LA-1/000'. Shown after the quantity when in stock. */
  bin?: string | null
  size?: 'sm' | 'md'
  className?: string
}

const LABEL: Record<StockState, string> = {
  in: 'במלאי',
  out: 'אין במלאי',
  unknown: 'מלאי לא ידוע',
}

const TONE: Record<StockState, string> = {
  in: 'text-[var(--jan-verdigris)] border-[color-mix(in_srgb,var(--jan-verdigris)_42%,transparent)] bg-[color-mix(in_srgb,var(--jan-verdigris)_9%,transparent)]',
  out: 'text-[var(--jan-faint)] border-[var(--jan-rule)] bg-transparent',
  unknown: 'text-[var(--jan-callout)] border-[color-mix(in_srgb,var(--jan-callout)_40%,transparent)] bg-[var(--jan-callout-soft)]',
}

/** The dot carries the state a second time, for readers who cannot use hue. */
const DOT: Record<StockState, string> = {
  in: 'bg-[var(--jan-verdigris)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--jan-verdigris)_18%,transparent)]',
  out: 'bg-transparent border border-current',
  unknown: 'bg-transparent border border-dashed border-current',
}

export function StockPill({ qty, bin, size = 'md', className }: StockPillProps) {
  const state = stockState(qty)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12.5px]',
        TONE[state],
        className,
      )}
      // Read as one fact, not as a dot then a number then a bin.
      aria-label={
        state === 'in'
          ? `${qty} יחידות במלאי${bin ? `, מחסן ${bin}` : ''}`
          : LABEL[state]
      }
    >
      <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', DOT[state])} />
      {state === 'in' ? (
        <>
          <span className="tabular-nums" dir="ltr">{qty}</span>
          <span>{LABEL.in}</span>
          {bin && (
            <span className="font-mono text-[0.85em] font-normal text-[var(--jan-faint)]" dir="ltr">
              {bin}
            </span>
          )}
        </>
      ) : (
        <span>{LABEL[state]}</span>
      )}
    </span>
  )
}

export default StockPill
