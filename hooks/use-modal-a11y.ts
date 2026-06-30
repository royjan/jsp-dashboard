import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessibility for hand-rolled modal/drawer dialogs: Escape to close, a Tab focus-trap,
 * initial focus into the panel, body scroll-lock, and focus restoration on unmount.
 * Pair with `role="dialog"` + `aria-modal="true"` on the panel element.
 */
export function useModalA11y(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusInitial = () => {
      const el = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
      el?.focus()
    }
    const t = setTimeout(focusInitial, 60)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [ref, onClose])
}
