'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ItemHoverCard } from './ItemHoverCard'

interface ItemLinkProps {
  code: string
  name?: string
  className?: string
  showCode?: boolean
  dir?: string
}

export function ItemLink({ code, name, className, showCode = false, dir }: ItemLinkProps) {
  // If name is same as code (no real description), treat as code display
  const hasRealName = name && name !== code && !/^\d{5,}$/.test(name)
  const display = showCode ? code : (hasRealName ? name : code)
  const isCodeDisplay = showCode || !hasRealName
  return (
    <ItemHoverCard code={code}>
      <Link
        href={`/items/${encodeURIComponent(code)}`}
        className={cn(
          'text-primary hover:underline hover:text-primary/80 transition-colors',
          isCodeDisplay && 'font-mono text-xs',
          className
        )}
        dir={dir}
      >
        {display}
      </Link>
    </ItemHoverCard>
  )
}
