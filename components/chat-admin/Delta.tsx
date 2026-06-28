'use client'

import React from 'react'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'

interface DeltaProps {
  /** Raw count delta (current - previous). Used when `pp` is false. */
  v?: number
  /** Percentage-point mode: compare cur vs prev rates. */
  pp?: boolean
  cur?: number
  prev?: number
  /** Which direction is "good" — colors green when moving the good way. */
  good?: 'up' | 'down'
  suffix?: string
}

/** Tiny up/down delta chip. Green when moving in the "good" direction. */
export function Delta({ v, pp, cur, prev, good = 'up', suffix }: DeltaProps) {
  let delta: number
  let display: string
  if (pp) {
    delta = Math.round(((cur ?? 0) - (prev ?? 0)) * 10) / 10
    display = `${delta > 0 ? '+' : ''}${delta}pp`
  } else {
    delta = v ?? 0
    display = `${delta > 0 ? '+' : ''}${delta.toLocaleString()}${suffix ?? ''}`
  }

  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[var(--color-text-tertiary,#8a8a90)]">
        <Minus className="h-3 w-3" /> flat
      </span>
    )
  }

  const isGood = good === 'up' ? delta > 0 : delta < 0
  const cls = isGood ? 'text-emerald-400' : 'text-red-400'
  const Icon = delta > 0 ? ArrowUp : ArrowDown

  return (
    <span className={`inline-flex items-center gap-0.5 ${cls}`}>
      <Icon className="h-3 w-3" />
      {display}
    </span>
  )
}

export default Delta
