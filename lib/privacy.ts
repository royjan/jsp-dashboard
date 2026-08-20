/**
 * privacy.ts — "demo mode": hide every money figure behind a mask so the
 * dashboard can be shown on a projector / screen-share / screenshot without
 * leaking Jan Parts' real revenue, debt and margins.
 *
 * Default is HIDDEN. A fresh page load always starts masked — the state is
 * deliberately NOT persisted, so nobody can start a demo with real numbers on
 * screen because the last session happened to reveal them. Client-side
 * navigation keeps the choice (it is module state, and the App Router does not
 * remount it).
 *
 * Shape: a plain external store (no React) so `format.ts` — which is imported
 * by server routes — can read it without pulling React in. The React side
 * lives in `use-money-hidden.ts`.
 */

/** What a masked money value renders as. Mirrors format.ts's '₪0' fallback shape. */
export const MONEY_MASK = '₪•••'

let hidden = true
const listeners = new Set<() => void>()

/** Read the current state. Safe to call during render on client and server. */
export function isMoneyHidden(): boolean {
  return hidden
}

export function setMoneyHidden(next: boolean): void {
  if (hidden === next) return
  hidden = next
  // Mirrored onto <html> so CSS can reach values we cannot re-render (canvas
  // overlays, third-party widgets) and so E2E/screenshot tooling can assert it.
  if (typeof document !== 'undefined') {
    document.documentElement.toggleAttribute('data-money-hidden', hidden)
  }
  for (const fn of listeners) fn()
}

export function toggleMoneyHidden(): void {
  setMoneyHidden(!hidden)
}

/** useSyncExternalStore subscribe. Returns the unsubscribe fn. */
export function subscribeMoneyHidden(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/**
 * Server snapshot. Always `true` — the server never has a user's toggle, and
 * starting hidden on both sides is what keeps hydration mismatch-free.
 */
export function getMoneyHiddenServerSnapshot(): boolean {
  return true
}
