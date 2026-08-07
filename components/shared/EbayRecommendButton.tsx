'use client'

import { useState, useEffect, useRef } from 'react'
import { Store } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { useEbayRecommendations, useToggleEbayRecommend } from '@/hooks/use-ebay-recommend'

interface EbayRecommendButtonProps {
  itemCode: string
  itemName?: string
  source?: string
  size?: 'sm' | 'default'
}

export function EbayRecommendButton({ itemCode, itemName, source = 'dashboard', size = 'sm' }: EbayRecommendButtonProps) {
  const { locale } = useLocale()
  const { data } = useEbayRecommendations()
  const { mutate: toggle, isPending } = useToggleEbayRecommend()
  const [toast, setToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const isRecommended = data?.items?.includes(itemCode) ?? false
  const he = locale === 'he'

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const willRecommend = !isRecommended
    toggle({ itemCode, itemName, source, isRecommended })

    const msg = willRecommend
      ? (he ? '✓ נוסף להמלצות eBay' : '✓ Added to eBay')
      : (he ? '✗ הוסר מהמלצות' : '✗ Removed from eBay')
    setToast(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2000)
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        onClick={handleClick}
        disabled={isPending}
        title={isRecommended
          ? (he ? 'הסר המלצת eBay' : 'Remove eBay recommendation')
          : (he ? 'המלץ ל-eBay' : 'Recommend for eBay')
        }
        className={cn(
          'inline-flex items-center justify-center rounded-md transition-all',
          'focus:outline-none focus:ring-1 focus:ring-ring',
          'disabled:opacity-50 disabled:pointer-events-none',
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
          'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
          isRecommended
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          isPending && 'animate-pulse',
        )}
      >
        <Store className={cn(
          size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
          isRecommended && 'fill-current'
        )} />
      </button>
      {toast && (
        <span className={cn(
          'absolute top-full mt-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-200',
          'bg-popover text-popover-foreground border border-border',
          locale === 'he' ? 'right-0' : 'left-0',
        )}>
          {toast}
        </span>
      )}
    </span>
  )
}
