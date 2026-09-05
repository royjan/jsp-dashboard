'use client'

/**
 * A scroll container a sticky header can actually latch onto.
 *
 * The most reproduced layout bug in the dashboard: a `<thead>` with
 * `position: sticky` inside a wrapper that has `overflow-x-auto`. CSS resolves
 * the OTHER axis to `auto` as well, so that wrapper becomes a scroll container —
 * one that never scrolls, because nothing constrains its height. The sticky
 * header dutifully sticks to it, the page scrolls underneath, and the header
 * rides away with the rows.
 *
 * Three things fix it and all three are required, which is why they belong in
 * one component rather than in a comment on each table:
 *
 *   1. a BOUNDED height, so there is a vertical scroll to stick within
 *   2. `overflow: auto` on that same element, so both axes scroll together
 *   3. an OPAQUE background on the header cells — the rows scroll UNDER it, and
 *      a transparent header shows them through
 *
 * The third is invisible in review and obvious the first time someone scrolls.
 * Style header cells with `.jan-sticky-head th`, which sets the background from
 * `--jan-steel` for you.
 *
 * The page's own sticky chrome is a second trap: TopBar is `sticky top-0 z-30
 * h-14`, so a page-level sticky element must sit at `top-14` with z below 30 or
 * it pins correctly and hides underneath. `offsetTop` is that knob.
 */

import * as React from 'react'
import { cn } from './cn'

export interface StickyHeadProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  /**
   * The height cap. Anything CSS accepts; the default leaves room for TopBar
   * plus a page heading. Pass 'none' to opt out and manage height yourself.
   */
  maxHeight?: string
  /** Distance from the top of the scroll container for the pinned header. */
  offsetTop?: number
  className?: string
}

export const DEFAULT_MAX_HEIGHT = 'calc(100dvh - 13rem)'

export function StickyHead({
  children, maxHeight = DEFAULT_MAX_HEIGHT, offsetTop = 0, className, style, ...rest
}: StickyHeadProps) {
  return (
    <div
      className={cn(
        'jan-sticky-head relative overflow-auto rounded-[var(--jan-radius)] border border-[var(--jan-rule)]',
        // Both axes on ONE element. Splitting them across nested wrappers is the
        // bug: the inner one silently becomes the scroll container.
        // `sticky` without a `top` never pins — the offset is the whole point.
        '[&_thead_th]:sticky [&_thead_th]:top-[var(--jan-sticky-top)]',
        '[&_thead_th]:z-[1] [&_thead_th]:bg-[var(--jan-steel)]',
        className,
      )}
      style={{
        maxHeight: maxHeight === 'none' ? undefined : maxHeight,
        // Applied via a custom property so the th rule above can read it without
        // a second arbitrary-value class per call site.
        ['--jan-sticky-top' as string]: `${offsetTop}px`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

export default StickyHead
