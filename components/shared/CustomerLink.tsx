'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

interface CustomerLinkProps {
  code: string
  name?: string | null
  className?: string
  showCode?: boolean
}

/** Link a customer code/name to its detail page (/customers/[code]). */
export function CustomerLink({ code, name, className, showCode = false }: CustomerLinkProps) {
  const display = showCode ? code : (name || code)
  return (
    <Link
      href={`/customers/${encodeURIComponent(code)}`}
      className={cn('text-primary hover:underline hover:text-primary/80 transition-colors', className)}
      dir="auto"
    >
      {display}
    </Link>
  )
}
