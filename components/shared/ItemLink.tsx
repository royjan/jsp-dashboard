'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { copyText } from '@/lib/clipboard'
import { ItemHoverCard } from './ItemHoverCard'

interface ItemLinkProps {
  code: string
  name?: string
  className?: string
  showCode?: boolean
  dir?: string
  /** Show a copy-to-clipboard button next to the code. Defaults on when showCode. */
  copyable?: boolean
}

export function ItemLink({ code, name, className, showCode = false, dir, copyable }: ItemLinkProps) {
  const [copied, setCopied] = useState(false)
  // If name is same as code (no real description), treat as code display
  const hasRealName = name && name !== code && !/^\d{5,}$/.test(name)
  const display = showCode ? code : (hasRealName ? name : code)
  const isCodeDisplay = showCode || !hasRealName
  const showCopy = copyable ?? showCode

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const ok = await copyText(code)
    if (ok) {
      setCopied(true)
      toast.success(`הועתק: ${code}`)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('ההעתקה נכשלה')
    }
  }

  const link = (
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

  if (!showCopy) return link

  return (
    <span className="inline-flex items-center gap-1">
      {link}
      <button
        type="button"
        onClick={handleCopy}
        title={`העתק ${code}`}
        aria-label={`העתק ${code}`}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  )
}
