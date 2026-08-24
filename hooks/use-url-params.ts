'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useCallback, useRef, useEffect } from 'react'

type ParamConfig = Record<string, string | undefined | null>

/**
 * Sync state with URL search params.
 * The setters are stable (never change identity) to avoid infinite loops when
 * used in useEffect dependency arrays. `get` deliberately is not: it changes
 * with the params it reads, so a render caused by a URL change sees that URL.
 */
export function useUrlParams() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // A ref for the router so the setters below can stay stable.
  const routerRef = useRef(router)
  const pendingRef = useRef<Record<string, string | null>>({})
  const rafRef = useRef<number | null>(null)

  useEffect(() => { routerRef.current = router }, [router])

  // Rebuilt from `window.location`, not from a mirrored `searchParams`: a
  // mirror caught up by an effect lands after paint, so a flush scheduled in
  // between would rebuild the query string from the previous URL and drop
  // whatever changed it. The address bar is never behind.
  const flush = useCallback(() => {
    const current = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(pendingRef.current)) {
      if (value === null || value === undefined || value === '') {
        current.delete(key)
      } else {
        current.set(key, value)
      }
    }
    pendingRef.current = {}
    const qs = current.toString()
    routerRef.current.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      flush()
    })
  }, [flush])

  // Reads the live `searchParams` — reading a mirror of it would hand the
  // render caused by a URL change the *previous* URL, and no re-render would
  // ever follow to correct that. Pending writes win over the URL so two clicks
  // inside one frame compound (7→8→9) instead of both computing 8.
  const get = useCallback((key: string): string | null => {
    if (key in pendingRef.current) return pendingRef.current[key]
    return searchParams.get(key)
  }, [searchParams])

  const set = useCallback((key: string, value: string | null) => {
    pendingRef.current[key] = value
    scheduleFlush()
  }, [scheduleFlush])

  const setMany = useCallback((params: ParamConfig) => {
    for (const [key, value] of Object.entries(params)) {
      pendingRef.current[key] = value ?? null
    }
    scheduleFlush()
  }, [scheduleFlush])

  return { get, set, setMany, searchParams }
}
