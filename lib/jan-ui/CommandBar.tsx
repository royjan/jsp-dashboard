'use client'

/**
 * Page chrome that gives its space back once you have read it.
 *
 * Partly's vehicle screen spends 165 vertical pixels before any content: three
 * stacked bars — brand and vehicle, then account and project actions, then the
 * tab row — plus two more controls floating over the canvas. On a laptop that is
 * a fifth of the window, permanently, for a 3D view that wants every pixel.
 *
 * The split is not about size, it is about how often each line is READ.
 * Identity — which vehicle am I looking at, which VIN — is read once on arrival
 * and then remembered. Actions are needed continuously. So identity collapses on
 * scroll and actions do not, and scrolling back up restores it, because "which
 * car was this again" is a real question with a cheap answer.
 *
 * The collapse animates `grid-template-rows` from `1fr` to `0fr` rather than
 * height or padding: those force layout on every frame, and this runs while the
 * user is scrolling, which is the worst possible moment to be re-laying out a
 * page that also holds a WebGL canvas.
 */

import * as React from 'react'
import { cn } from './cn'

export interface CommandBarProps {
  /** Read once: brand, vehicle, VIN. This is what folds away. */
  identity: React.ReactNode
  /** Needed throughout: tabs, actions, filters. This always stays. */
  actions: React.ReactNode
  /** Scroll distance in px before folding. Default 16. */
  threshold?: number
  /**
   * The element that scrolls. Omit for the window — pass a ref when the bar
   * lives inside its own scroll area.
   */
  scrollRef?: React.RefObject<HTMLElement | null>
  className?: string
}

export function CommandBar({
  identity, actions, threshold = 16, scrollRef, className,
}: CommandBarProps) {
  const [tight, setTight] = React.useState(false)

  React.useEffect(() => {
    const target: HTMLElement | Window = scrollRef?.current ?? window
    const read = () =>
      target === window
        ? window.scrollY
        : (target as HTMLElement).scrollTop
    const onScroll = () => setTight(read() > threshold)
    onScroll()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [scrollRef, threshold])

  return (
    <div
      className={cn(
        'sticky top-0 z-10 border-b border-[var(--jan-rule)] bg-[var(--jan-steel)]',
        className,
      )}
    >
      <div
        className="jan-anim grid"
        style={{
          gridTemplateRows: tight ? '0fr' : '1fr',
          transition: 'grid-template-rows var(--jan-base) var(--jan-ease)',
        }}
      >
        {/* min-h-0 is what lets the 0fr track actually collapse its child. */}
        <div
          className="min-h-0 overflow-hidden"
          style={{
            opacity: tight ? 0 : 1,
            transition: 'opacity var(--jan-base) var(--jan-ease)',
          }}
          // Folded chrome is not reachable by keyboard either, or Tab lands on
          // something nobody can see.
          {...(tight ? { inert: '' as unknown as boolean, 'aria-hidden': true } : {})}
        >
          <div className="flex flex-wrap items-center gap-2.5 px-3.5 pt-3">{identity}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">{actions}</div>
    </div>
  )
}

export default CommandBar
