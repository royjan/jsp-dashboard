'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useCallback, useRef, useEffect } from 'react'

type ParamConfig = Record<string, string | undefined | null>

/**
 * Sync state with URL search params.
 * All returned functions are stable (never change identity) to avoid
 * infinite loops when used in useEffect dependency arrays.
 */
export function useUrlParams() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Refs to avoid recreating callbacks when these change
  const searchParamsRef = useRef(searchParams)
  const routerRef = useRef(router)
  const pathnameRef = useRef(pathname)
  const pendingRef = useRef<Record<string, string | null>>({})
  const rafRef = useRef<number | null>(null)

  useEffect(() => { searchParamsRef.current = searchParams }, [searchParams])
  useEffect(() => { routerRef.current = router }, [router])
  useEffect(() => { pathnameRef.current = pathname }, [pathname])

  const flush = useCallback(() => {
    const current = new URLSearchParams(searchParamsRef.current.toString())
    for (const [key, value] of Object.entries(pendingRef.current)) {
      if (value === null || value === undefined || value === '') {
        current.delete(key)
      } else {
        current.set(key, value)
      }
    }
    pendingRef.current = {}
    const qs = current.toString()
    routerRef.current.replace(`${pathnameRef.current}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      flush()
    })
  }, [flush])

  const get = useCallback((key: string): string | null => {
    return searchParamsRef.current.get(key)
  }, [])

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
