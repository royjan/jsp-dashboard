'use client'

/**
 * The handful of things you were just looking at.
 *
 * The palette already searches items, the Partly catalogue and customers, which
 * covers "find something I know the code for". What it did not cover is the
 * commoner case in a support call: going back to the part or customer you had
 * open two minutes ago, whose code you did not memorise.
 *
 * Module store rather than a hook-with-state, for the same reason as the money
 * mask and the density toggle: the recording happens in a route handler far
 * from the palette, and the palette must re-render when it changes.
 *
 * Deliberately capped and deliberately dumb — no frecency, no scoring. A list
 * of the last few things, in order, is legible; a ranked list that reorders
 * itself is not, and this is a keyboard surface where muscle memory matters
 * more than cleverness.
 */

import * as React from 'react'

const STORAGE_KEY = 'ui.recentDestinations'
const MAX = 8

export interface RecentDestination {
  /** Route to push. Also the identity — visiting the same page twice moves it up rather than duplicating. */
  href: string
  /** Primary line: the code, the customer name. */
  label: string
  /** Secondary line. Optional. */
  sublabel?: string
  kind: 'item' | 'customer' | 'document' | 'page'
  /** Epoch ms, for ordering. */
  at: number
}

let items: RecentDestination[] = []
let loaded = false
const listeners = new Set<() => void>()

function load(): RecentDestination[] {
  if (loaded) return items
  loaded = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) items = parsed.filter(isValid).slice(0, MAX)
    }
  } catch {
    // Private browsing throws on ACCESS, not just on write.
    items = []
  }
  return items
}

/** A shape written by an older build must not crash the palette. */
function isValid(d: unknown): d is RecentDestination {
  if (!d || typeof d !== 'object') return false
  const r = d as Record<string, unknown>
  return typeof r.href === 'string' && typeof r.label === 'string' && typeof r.at === 'number'
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* storage blocked — the list still works for this session */
  }
}

function emit() {
  for (const l of listeners) l()
}

export function recordDestination(d: Omit<RecentDestination, 'at'>): void {
  if (typeof window === 'undefined') return
  load()
  // De-duplicate on href so revisiting promotes rather than repeats.
  items = [{ ...d, at: Date.now() }, ...items.filter(i => i.href !== d.href)].slice(0, MAX)
  persist()
  emit()
}

export function clearRecentDestinations(): void {
  items = []
  persist()
  emit()
}

export function useRecentDestinations(): RecentDestination[] {
  const value = React.useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => items,
    // Server snapshot is empty: this is per-browser state and rendering it
    // during SSR would be a hydration mismatch on every page.
    () => EMPTY,
  )

  React.useEffect(() => {
    const before = items
    load()
    if (items !== before) emit()
  }, [])

  return value
}

const EMPTY: RecentDestination[] = []
