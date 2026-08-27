'use client'

/**
 * Table density, shared by every DataTable on the page.
 *
 * Deliberately a module-level store rather than a React context: DataTable is
 * mounted in ~40 places across pages that do not share a provider boundary, and
 * threading a provider through each of them is exactly the kind of per-page
 * edit this component exists to avoid. Same shape as the money-mask store
 * (lib/use-money-hidden), so there is one pattern to learn, not two.
 *
 * 'compact' roughly doubles the rows on screen, which is what you want on a
 * stock or ledger table; 'comfortable' stays the default because it is the
 * touch target the sales-rep screens rely on.
 */

import * as React from 'react'

export type Density = 'comfortable' | 'compact'

const STORAGE_KEY = 'ui.density'

let current: Density = 'comfortable'
const listeners = new Set<() => void>()

function read(): Density {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === '"compact"' || raw === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function emit() {
  for (const l of listeners) l()
}

export function setDensity(next: Density): void {
  if (next === current) return
  current = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* blocked storage — the toggle still works for this session */
  }
  emit()
}

export function toggleDensity(): void {
  setDensity(current === 'compact' ? 'comfortable' : 'compact')
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Reads the stored value once on mount. The server snapshot is always
 * 'comfortable' so SSR and the first client render agree; the stored value is
 * adopted immediately after, which is a style swap rather than a layout jump.
 */
export function useDensity(): Density {
  const value = React.useSyncExternalStore(
    subscribe,
    () => current,
    () => 'comfortable' as Density,
  )

  React.useEffect(() => {
    const stored = read()
    if (stored !== current) {
      current = stored
      emit()
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        current = read()
        emit()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return value
}

export default useDensity
