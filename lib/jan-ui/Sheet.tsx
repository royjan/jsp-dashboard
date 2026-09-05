'use client'

/**
 * The bottom sheet none of the four apps had.
 *
 * Row detail on a phone currently opens as a dialog in the middle of the screen,
 * which asks a thumb to travel to an X in a corner it cannot reach. A sheet
 * comes up from the bottom, sits under the hand, and closes with the gesture
 * every native app has already taught: drag it down.
 *
 * THE THRESHOLD IS TWO TESTS, NOT ONE. A slow drag past a third of the sheet's
 * height dismisses it; so does a fast flick, however short. Distance alone means
 * a quick flick springs back and feels broken; velocity alone means a careful
 * drag to the floor does nothing.
 *
 * `touch-action: none` is on the SHEET and nothing above it. Put it on a parent
 * and the page underneath stops scrolling for the rest of the session.
 */

import * as React from 'react'
import { cn } from './cn'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  /** Full-height variant for long content; default hugs its content. */
  tall?: boolean
  className?: string
}

const DISMISS_FRACTION = 0.32
const DISMISS_VELOCITY = 0.55   /* px per ms */

export function Sheet({ open, onClose, title, children, tall = false, className }: SheetProps) {
  const el = React.useRef<HTMLDivElement>(null)
  const [shown, setShown] = React.useState(false)

  React.useEffect(() => {
    if (!open) { setShown(false); return }
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const drag = React.useRef({ down: false, y0: 0, dy: 0, t0: 0 })

  const start = (e: React.PointerEvent) => {
    const node = el.current
    if (!node) return
    drag.current = { down: true, y0: e.clientY, dy: 0, t0: performance.now() }
    node.style.transition = 'none'
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const node = el.current
    if (!node || !drag.current.down) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y0)
    node.style.transform = `translateY(${drag.current.dy}px)`
  }
  const end = () => {
    const node = el.current
    if (!node || !drag.current.down) return
    const { dy, t0 } = drag.current
    drag.current.down = false
    node.style.transition = ''
    node.style.transform = ''
    const v = dy / Math.max(1, performance.now() - t0)
    if (dy > node.offsetHeight * DISMISS_FRACTION || v > DISMISS_VELOCITY) {
      setShown(false)
      window.setTimeout(onClose, 220)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div
        className={cn(
          'absolute inset-0 bg-black/45 transition-opacity duration-300',
          shown ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <div
        ref={el}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-[var(--jan-rule)]',
          'bg-[var(--jan-steel)] px-5 pb-6 pt-2 shadow-[0_-20px_50px_rgba(0,0,0,.35)]',
          'touch-none will-change-transform',
          tall && 'max-h-[86dvh] overflow-y-auto',
          'transition-transform duration-[380ms] ease-[var(--jan-ease)]',
          shown ? 'translate-y-0' : 'translate-y-full',
          className,
        )}
      >
        {/* The handle is the affordance AND the drag target: making the whole
            sheet draggable means a scroll inside it dismisses it by accident. */}
        <span
          className="mx-auto mb-3 block h-1 w-10 cursor-grab rounded-full bg-[var(--jan-rule)]"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-hidden="true"
        />
        {title && <div className="mb-3 text-[15px] font-semibold text-[var(--jan-ink)]">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export default Sheet
