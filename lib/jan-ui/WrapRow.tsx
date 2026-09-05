'use client'

/**
 * A row of controls that survives the reader's font size.
 *
 * A full mobile pass measured every route clean between 320px and 1280px, and
 * /projects still broke by 33px on a phone with the system text size turned up.
 * Emulating a narrower viewport never catches this, because the container
 * shrinks along with it — the text does not.
 *
 * The shape is always the same: a `flex` row with no `flex-wrap`, sized exactly
 * to its labels, that fit the viewport by coincidence. Seven of them existed at
 * once, including ToggleGroup itself and ProjectMenu — which sits in every
 * page's header, so the failure was on every screen.
 *
 * Two properties fix it and both are required. `flex-wrap` lets the row become
 * two rows; `min-width: 0` on the children lets a single long label shrink
 * instead of forcing the track wider than its parent. Tailwind's `text-*` are
 * rem, so everything grows together — which is why this is a container concern
 * and not something each label can solve.
 *
 * To reproduce a report: set `document.documentElement.style.fontSize = '20px'`
 * and re-measure. `scrollWidth - clientWidth` on the page is the overflow.
 */

import * as React from 'react'
import { cn } from './cn'

export interface WrapRowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  /** Gap between items, Tailwind spacing scale. Default 2. */
  gap?: string
  /** Push the last child to the far end (an action beside a filter group). */
  spread?: boolean
  className?: string
}

export function WrapRow({
  children, gap = 'gap-2', spread = false, className, ...rest
}: WrapRowProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center',
        gap,
        // Every direct child may shrink. Without this one long Hebrew label
        // sets the row's min-content width and the wrap never helps.
        '[&>*]:min-w-0',
        spread && '[&>*:last-child]:ms-auto',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export default WrapRow
