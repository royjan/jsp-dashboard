'use client'

/**
 * What Xpart holds for this supplier, on the supplier's own page.
 *
 * The two systems know different halves of the same relationship: the dashboard
 * knows what arrived and what we sold, Xpart knows what we ordered and what
 * they charge. Joined on suppliers.finansit_code = supplier_profiles.supplier_code.
 *
 * Renders nothing when the supplier is not in Xpart — most ERP suppliers are
 * not, and an empty "Xpart" box on every one of them is worse than silence.
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Boxes } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { XpartLink } from '@/components/xpart/XpartLink'
import { xpartUrl } from '@/lib/xpart-links'
import { formatNumber } from '@/lib/format'

interface Context {
  supplier_id: string
  code: string
  name: string
  supplier_role: string | null
  currency: string | null
  default_price_term: string | null
  open_orders: number
  open_items: number
  open_value_by_currency: Record<string, number>
  last_order_date: string | null
  price_lists: Array<{
    price_list_id: string
    name: string
    status: string
    currency: string
    total_items: number | null
    effective_date: string | null
  }>
}

const MONEY = new Map<string, Intl.NumberFormat>()
function money(v: number, currency: string): string {
  if (!MONEY.has(currency)) {
    MONEY.set(currency, new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }))
  }
  return MONEY.get(currency)!.format(v)
}

export function XpartSupplierStrip({ code }: { code: string }) {
  const { data } = useQuery<{ linked: boolean; context?: Context }>({
    queryKey: ['xpart-supplier-context', code],
    queryFn: async () => {
      const res = await fetch(`/api/xpart/suppliers/${encodeURIComponent(code)}`)
      if (!res.ok) throw new Error('xpart context unavailable')
      return res.json()
    },
    enabled: !!code,
    staleTime: 30 * 60 * 1000,
  })

  const c = data?.linked ? data.context : null
  if (!c) return null

  const activeList = c.price_lists.find(l => l.status === 'active')

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Boxes className="h-4 w-4 text-blue-500" />
          Xpart
          <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
        </div>

        <div>
          <div className="text-xs text-muted-foreground">הזמנות פתוחות</div>
          <div className="text-sm font-semibold tabular-nums">
            {formatNumber(c.open_orders)}
            {c.open_items > 0 && (
              <span className="ms-1 text-xs font-normal text-muted-foreground">
                · {formatNumber(c.open_items)} פריטים
              </span>
            )}
          </div>
        </div>

        {Object.entries(c.open_value_by_currency).map(([cur, total]) => (
          <div key={cur}>
            <div className="text-xs text-muted-foreground">שווי {cur}</div>
            <div className="text-sm font-semibold tabular-nums">{money(total, cur)}</div>
          </div>
        ))}

        {activeList && (
          <div>
            <div className="text-xs text-muted-foreground">מחירון פעיל</div>
            <Link
              href={`/price-lists/${activeList.price_list_id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {activeList.name}
              <span className="ms-1 text-xs font-normal text-muted-foreground">
                {activeList.total_items ? `· ${formatNumber(activeList.total_items)}` : ''}
              </span>
            </Link>
          </div>
        )}

        {c.last_order_date && (
          <div>
            <div className="text-xs text-muted-foreground">הזמנה אחרונה</div>
            <div className="text-sm tabular-nums">{c.last_order_date.slice(0, 10)}</div>
          </div>
        )}

        <div className="ms-auto flex items-center gap-2">
          <Link
            href="/shipments/on-the-way"
            className="rounded border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            בדרך
          </Link>
          <XpartLink href={xpartUrl.supplier(c.supplier_id)} label="פתח ב‑Xpart" />
        </div>
      </CardContent>
    </Card>
  )
}
