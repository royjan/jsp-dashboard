'use client'

/**
 * Which purchase order did this shipment come from?
 *
 * Nothing in the data answers that. The warehouse scan is a Firestore document
 * written by the barcode app; the purchase order lives in Xpart and was pushed
 * to Finansit as a 61. They share no key — not an order number, not a reference
 * — only a supplier and a rough sense of time.
 *
 * So this is deliberately a shortlist, not a match: that supplier's orders
 * placed on or before the day the goods were scanned, newest first. Calling one
 * of them "the" order would be a guess presented as a fact, and attaching a
 * scan to the wrong PO is worse than leaving it unattached. A human picks.
 */

import { useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { XpartLink } from '@/components/xpart/XpartLink'
import { xpartUrl } from '@/lib/xpart-links'
import { formatNumber } from '@/lib/format'

interface Order {
  order_id: string
  order_number: string
  status: string
  order_date: string | null
  finansit_doc_number: string | null
  total_items: number | null
  total_value: number | null
  currency: string | null
  inquiry_number: string | null
}

const MONEY = new Map<string, Intl.NumberFormat>()
function money(v: number, currency: string): string {
  if (!MONEY.has(currency)) {
    MONEY.set(currency, new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }))
  }
  return MONEY.get(currency)!.format(v)
}

export function ShipmentOrderCandidates({
  supplierCode,
  arrivedOn,
  isHe,
}: {
  supplierCode: string | null | undefined
  arrivedOn: string | null | undefined
  isHe: boolean
}) {
  const { data } = useQuery<{ linked: boolean; candidateOrders?: Order[] }>({
    queryKey: ['xpart-shipment-candidates', supplierCode, arrivedOn],
    queryFn: async () => {
      const p = new URLSearchParams()
      if (arrivedOn) p.set('arrivedOn', String(arrivedOn).slice(0, 10))
      const res = await fetch(`/api/xpart/suppliers/${encodeURIComponent(supplierCode!)}?${p}`)
      if (!res.ok) throw new Error('candidates unavailable')
      return res.json()
    },
    enabled: !!supplierCode,
    staleTime: 30 * 60 * 1000,
  })

  const orders = data?.linked ? (data.candidateOrders ?? []) : []
  if (orders.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-blue-500" />
          {isHe ? 'הזמנות רכש אפשריות' : 'Possible purchase orders'}
          <span className="text-xs font-normal text-muted-foreground">
            {isHe
              ? 'הזמנות הספק שקדמו למשלוח — אין מפתח משותף, זו רשימת מועמדים'
              : "the supplier's orders before this arrival — no shared key, so these are candidates"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {orders.map(o => (
          <div key={o.order_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="font-mono text-xs">{o.order_number}</span>
            <span className="text-muted-foreground">{o.order_date?.slice(0, 10) ?? '—'}</span>
            {o.finansit_doc_number && (
              <span className="font-mono text-xs text-muted-foreground">61/{o.finansit_doc_number}</span>
            )}
            <span className="tabular-nums">{formatNumber(o.total_items ?? 0)} {isHe ? 'פריטים' : 'items'}</span>
            {o.total_value != null && (
              <span className="tabular-nums font-medium">{money(o.total_value, o.currency ?? 'EUR')}</span>
            )}
            <span className="text-xs text-muted-foreground">{o.status}</span>
            {o.inquiry_number && <span className="text-xs text-muted-foreground">{o.inquiry_number}</span>}
            <XpartLink href={xpartUrl.order(o.order_id)} className="ms-auto" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
