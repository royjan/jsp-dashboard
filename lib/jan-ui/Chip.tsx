'use client'

/**
 * A small status pill.
 *
 * `bad` is the one that earns its keep: it means the source could not SEE,
 * which is a different fact from seeing zero. Every app here has shipped a
 * confident zero that was really a failed read, so the vocabulary distinguishes
 * them even when the number cannot.
 */

import * as React from 'react'
import { cn } from './cn'

export type ChipTone = 'neutral' | 'good' | 'warn' | 'bad'

const TONE: Record<ChipTone, string> = {
  neutral: 'text-[var(--jan-dim)] border-[var(--jan-rule)] bg-[var(--jan-raise)]',
  good: 'text-[var(--jan-verdigris)] border-[color-mix(in_srgb,var(--jan-verdigris)_35%,transparent)] bg-[color-mix(in_srgb,var(--jan-verdigris)_9%,transparent)]',
  warn: 'text-[var(--jan-callout)] border-[color-mix(in_srgb,var(--jan-callout)_35%,transparent)] bg-[var(--jan-callout-soft)]',
  bad: 'text-[var(--jan-oxide)] border-[color-mix(in_srgb,var(--jan-oxide)_35%,transparent)] bg-[color-mix(in_srgb,var(--jan-oxide)_9%,transparent)]',
}

export function Chip({
  tone = 'neutral', children, className, ...rest
}: { tone?: ChipTone; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]',
        TONE[tone], className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
export default Chip
