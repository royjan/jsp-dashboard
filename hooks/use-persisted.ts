'use client'

/**
 * useState that survives a reload.
 *
 * Every UI preference in this app used to be plain useState, so collapsing the
 * sidebar or hiding money lasted exactly until the next full navigation. The
 * state is per-browser and cosmetic — losing it is harmless, which is why
 * localStorage is the right store and why every access is wrapped.
 *
 * The try/catch is not defensive padding: in Safari private browsing and with
 * "block all cookies" set, `localStorage` throws on ACCESS, not just on write.
 * An unguarded read here would take down the whole shell.
 *
 * Built on useSyncExternalStore rather than useState+useEffect. That is what
 * makes it hydration-safe without writing state from an effect: the server
 * snapshot is always the caller's default (so SSR markup and the first client
 * render agree), and the stored value is adopted on the client in the same
 * pass. It also gives cross-tab agreement for free — the same person often has
 * the stock screen and a customer open side by side.
 */

import * as React from 'react'

/**
 * getSnapshot must return a REFERENTIALLY STABLE value or React re-renders
 * forever, and JSON.parse returns a fresh object every call. So parse only
 * when the raw string actually changed, and hand back the cached object
 * otherwise.
 */
const cache = new Map<string, { raw: string | null; parsed: unknown }>()
const listeners = new Map<string, Set<() => void>>()

function rawFor(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function snapshot<T>(key: string, fallback: T): T {
  const raw = rawFor(key)
  const hit = cache.get(key)
  if (hit && hit.raw === raw) return hit.parsed as T

  let parsed: unknown = fallback
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = fallback // a value written by an older build
    }
  }
  cache.set(key, { raw, parsed })
  return parsed as T
}

function emit(key: string) {
  for (const l of listeners.get(key) ?? []) l()
}

function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(cb)

  const onStorage = (e: StorageEvent) => {
    if (e.key === key) emit(key)
  }
  window.addEventListener('storage', onStorage)

  return () => {
    set!.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function usePersisted<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const initialRef = React.useRef(initial)

  const value = React.useSyncExternalStore(
    React.useCallback(cb => subscribe(key, cb), [key]),
    React.useCallback(() => snapshot<T>(key, initialRef.current), [key]),
    React.useCallback(() => initialRef.current, []),
  )

  const setValue = React.useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: T) => T)(snapshot<T>(key, initialRef.current))
          : next
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved))
      } catch {
        // Quota, private mode, or blocked storage. Keep the value for this
        // session so the control still responds, it just will not persist.
        cache.set(key, { raw: JSON.stringify(resolved), parsed: resolved })
      }
      emit(key)
    },
    [key],
  )

  return [value, setValue]
}

export default usePersisted
