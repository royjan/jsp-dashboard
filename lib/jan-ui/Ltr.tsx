'use client'

/**
 * A Latin island inside a Hebrew sentence.
 *
 * Part numbers, VINs, bin codes and SQL fragments are LTR runs sitting in RTL
 * paragraphs, and the Unicode bidi algorithm resolves the neutral characters
 * around them against the PARAGRAPH direction, not the run's. Signs, brackets
 * and separators then land on the wrong side.
 *
 * This is not hypothetical. Diego's catalogue answer shows
 *
 *     קרב סינון +702 +ספוג 802-803
 *
 * where the ERP's value is `702+`. The plus is a European Terminator: in an RTL
 * paragraph it attaches to the wrong end of the digits and moves. Nobody typed
 * that; the renderer did it. `(AND AGE > 3)` is worse — the brackets mirror and
 * the comparison appears to point the other way.
 *
 * `unicode-bidi: isolate` with an explicit `dir` closes the run so the
 * surrounding Hebrew cannot reach into it. The commit "The flow-decisions
 * screens were an LTR island inside an RTL app" fixed this on one screen; this
 * is that fix as a default.
 *
 * Reach for it on every code, identifier and expression rendered inside Hebrew
 * text — it costs one span and it is invisible when it was not needed.
 */

import * as React from 'react'
import { cn } from './cn'

export interface LtrProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode
  /** Render in the mono face. On by default: these are codes, not prose. */
  mono?: boolean
  className?: string
}

export function Ltr({ children, mono = true, className, ...rest }: LtrProps) {
  return (
    <span
      dir="ltr"
      // `isolate` rather than `embed`: embed still lets neutrals at the edges
      // resolve against the outer paragraph, which is the half of the bug that
      // moves the trailing punctuation.
      style={{ unicodeBidi: 'isolate' }}
      className={cn(mono && 'font-mono tabular-nums', className)}
      {...rest}
    >
      {children}
    </span>
  )
}

/**
 * The same isolation for a whole block — a SQL preview, a log line, a VIN table
 * cell — where the content is LTR end to end rather than a word inside Hebrew.
 */
export function LtrBlock({ children, className, ...rest }: LtrProps) {
  return (
    <div
      dir="ltr"
      style={{ unicodeBidi: 'isolate' }}
      className={cn('text-start font-mono', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

/* A Latin/numeric token inside Hebrew prose: a code, a size, a `702+`, an
 * `802-803`. Leading char must be alphanumeric so a bare '+' or '·' between two
 * Hebrew words is left alone — those are genuine neutrals and the paragraph
 * direction is the right answer for them. */
const TOKEN = /[A-Za-z0-9][A-Za-z0-9+\-._/#:%()]*/g

/**
 * Hebrew text with its Latin islands isolated, one span each.
 *
 * THE BUG THIS EXISTS FOR. Diego's catalogue answer renders
 *
 *     קרב סינון +702 +ספוג 802-803
 *
 * where the ERP's value is `702+`. Nobody typed that. `+` is a European
 * Terminator: inside an RTL paragraph the bidi algorithm resolves it against the
 * PARAGRAPH direction, not against the digits it is attached to, so it jumps to
 * the other end of the number. A part number that reads back wrong is a part
 * number a customer cannot order.
 *
 * `Ltr` already fixed this for a code rendered on its own. It could not fix it
 * for a code sitting INSIDE a sentence, which is where catalogue names put them,
 * because that needs the string split first. This is that split.
 *
 * Deliberately not styled: these are words in a name, not codes in a table, so
 * they stay in the surrounding face and only their direction is fixed.
 */
export function MixedText({ children, className }: { children: string | null | undefined; className?: string }) {
  const text = children ?? ''
  if (!text) return null

  const out: React.ReactNode[] = []
  let last = 0
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <span key={m.index} dir="ltr" style={{ unicodeBidi: 'isolate' }}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))

  /* Nothing to isolate: return the string itself rather than a wrapper, so the
     common case adds no element to the tree. */
  if (out.length === 1 && typeof out[0] === 'string') {
    return className ? <span className={className}>{text}</span> : <>{text}</>
  }
  return <span className={className}>{out}</span>
}

export default Ltr
