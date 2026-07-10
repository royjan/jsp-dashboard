'use client'

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { Package, TrendingUp, MapPin, Loader2 } from 'lucide-react'
import { useLocale } from '@/lib/locale-context'

interface ItemData {
  code: string
  canonical_code?: string
  canonical_name?: string
  name: string
  long_description?: string | null
  stock_qty: number | null
  incoming_qty: number | null
  ordered_qty: number | null
  price: number | null
  price_list_price?: number | null
  sold_this_year: number | null
  sold_last_year: number | null
  sold_2y_ago: number | null
  sold_3y_ago: number | null
  place: string | null
}

// Positive results cache indefinitely; negative ("not found") results expire
// after 30s so a lookup that failed before a deploy/data-sync can self-heal
// without a full page reload.
const NEG_TTL_MS = 30_000
const cache = new Map<string, ItemData>()
const negCache = new Map<string, number>()

function SalesBars({ item, isHe }: { item: ItemData; isHe: boolean }) {
  const values = [item.sold_3y_ago ?? 0, item.sold_2y_ago ?? 0, item.sold_last_year ?? 0, item.sold_this_year ?? 0]
  const max = Math.max(...values, 1)
  const labels = isHe ? ['3ש-', '2ש-', '1ש-', 'היום'] : ['-3Y', '-2Y', '-1Y', 'Now']
  return (
    <div className="flex items-end gap-1 h-8">
      {values.map((v, i) => (
        <div key={labels[i]} className="flex flex-col items-center gap-0.5" title={`${labels[i]}: ${v}`}>
          <div
            className="w-4 rounded-sm"
            style={{
              height: Math.max((v / max) * 24, 2),
              backgroundColor: i === 3 ? '#3b82f6' : '#94a3b8',
            }}
          />
          <span className="text-[8px] text-muted-foreground">{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

function StockIndicator({ value, label }: { value: number | null; label: string }) {
  const qty = value ?? 0
  const color = qty > 20 ? 'text-green-600' : qty > 0 ? 'text-amber-500' : 'text-red-500'
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${color}`}>{qty}</span>
    </div>
  )
}

function ItemPopoverContent({ item }: { item: ItemData }) {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const displayName = item.canonical_name || item.name
  const displayCode = item.canonical_code || item.code
  const itemPrice = item.price_list_price || item.price
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] font-mono text-muted-foreground">{displayCode}</div>
        <div className="text-sm font-semibold" dir="auto">{displayName || '—'}</div>
        {item.long_description && item.long_description !== displayName && (
          <div className="text-xs text-muted-foreground" dir="auto">{item.long_description}</div>
        )}
      </div>

      <div className="bg-muted/50 rounded-md p-2.5 space-y-1">
        <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
          <Package className="h-3 w-3" />
          {isHe ? 'מלאי' : 'Stock'}
        </div>
        <StockIndicator value={item.stock_qty} label={isHe ? 'במלאי' : 'On Hand'} />
        <StockIndicator value={item.incoming_qty} label={isHe ? 'בדרך' : 'Incoming'} />
        <StockIndicator value={item.ordered_qty} label={isHe ? 'הוזמן' : 'Ordered'} />
      </div>

      <div className="flex justify-between items-end">
        {itemPrice != null && itemPrice > 0 && (
          <div className="text-lg font-bold">₪{itemPrice.toLocaleString()}</div>
        )}
        <div className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-muted-foreground" />
          <SalesBars item={item} isHe={isHe} />
        </div>
      </div>

      {item.place && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {item.place}
        </div>
      )}
    </div>
  )
}

export function ItemHoverCard({ code, children }: { code: string; children: ReactNode }) {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [item, setItem] = useState<ItemData | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  // Radix HoverCard is hover-only (dead on touch). On a coarse pointer we control
  // `open` ourselves: first tap opens the card, a second tap on the link navigates,
  // and a tap outside closes it. Desktop hover is unchanged (Radix drives open).
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLAnchorElement>(null)

  const fetchItem = useCallback(async () => {
    if (!code) return
    const cached = cache.get(code)
    if (cached) { setItem(cached); return }
    const negAt = negCache.get(code)
    if (negAt && Date.now() - negAt < NEG_TTL_MS) { setNotFound(true); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(code)}`)
      if (res.ok) {
        const data = await res.json()
        cache.set(code, data)
        negCache.delete(code)
        setItem(data)
      } else if (res.status === 404) {
        // Genuine "not found" — cache briefly and show the message.
        negCache.set(code, Date.now())
        setNotFound(true)
      }
      // Transient (5xx / failover hiccup): leave notFound false and don't cache,
      // so the next hover retries instead of getting stuck on "not found".
    } catch {
      // Network/timeout — also transient; allow a retry on the next hover.
    } finally {
      setLoading(false)
    }
  }, [code])

  const isCoarse = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  // On touch: first tap opens the card (blocking navigation); a second tap on the
  // same link (card already open) navigates as usual.
  const onTriggerClickCapture = (e: React.MouseEvent) => {
    if (!isCoarse() || open) return
    e.preventDefault(); e.stopPropagation()
    if (!item && !loading && !notFound) fetchItem()
    setOpen(true)
  }

  // Close on a tap outside the trigger/content (touch has no "mouse leave").
  useEffect(() => {
    if (!open) return
    const onDoc = (e: Event) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || contentRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc, true)
    return () => document.removeEventListener('pointerdown', onDoc, true)
  }, [open])

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span
          ref={triggerRef}
          onMouseEnter={() => { if (!item && !loading && !notFound) fetchItem() }}
          onClickCapture={onTriggerClickCapture}
        >
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72">
        {/* The whole card is a link to the item page — on touch the open card
            overlays the tapped row, so tapping the card (not the hidden link
            underneath) must navigate. */}
        <Link
          ref={contentRef}
          href={`/items/${encodeURIComponent(code)}`}
          onClick={() => setOpen(false)}
          className="block hover:opacity-90 transition-opacity"
        >
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isHe ? 'טוען…' : 'Loading…'}
            </div>
          ) : item ? (
            <ItemPopoverContent item={item} />
          ) : notFound ? (
            <div className="text-sm text-muted-foreground py-1">{isHe ? 'הפריט לא נמצא' : 'Item not found'}</div>
          ) : null}
          {(item || notFound) && (
            <div className="mt-2 pt-2 border-t text-[11px] text-primary text-center">
              {isHe ? 'פתח דף פריט ↗' : 'Open item page ↗'}
            </div>
          )}
        </Link>
      </HoverCardContent>
    </HoverCard>
  )
}
