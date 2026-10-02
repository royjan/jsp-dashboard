'use client'

import { GitBranch } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ItemLink } from '@/components/shared/ItemLink'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'

export interface ChainBreakdownRow {
  item_code: string
  qty?: number | null
  place?: string | null
  price?: number | null
}

/**
 * Where a re-coded part's stock actually sits, per code in its replacement chain.
 *
 * FINAPI sums stock across the chain and quotes the NEWEST code's price, so the KPI cards
 * show one number each. This card is the "why": 6501627780 shows 10 because all ten are
 * still booked under 1681371180 on B-7/5. Rendered only when the chain has more than one
 * code — a part that was never re-coded has nothing to break down.
 */
export function ChainBreakdownCard({ rows, current, place, isHe }: {
  rows: ChainBreakdownRow[] | null | undefined
  current: string
  place?: string | null
  isHe: boolean
}) {
  useMoneyHidden()   // re-render the prices when the demo-mode eye toggles
  const list = (rows ?? []).filter((r) => r && r.item_code)
  if (list.length < 2) return null
  const total = list.reduce((s, r) => s + (Number(r.qty) || 0), 0)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch className="h-4 w-4 text-primary" />
          {isHe ? 'מלאי לפי קוד בשרשרת ההחלפות' : 'Stock per code in the replacement chain'}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {isHe
            ? 'אותו חלק תחת כמה מק״טים. המלאי מסוכם, המחיר הוא של הקוד החדש ביותר.'
            : 'One part under several codes. Stock is summed; the price is the newest code’s.'}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pe-3 text-start font-medium">{isHe ? 'מק״ט' : 'Code'}</th>
                <th className="py-2 pe-3 text-end font-medium">{isHe ? 'מלאי' : 'Stock'}</th>
                <th className="py-2 pe-3 text-start font-medium">{isHe ? 'מדף' : 'Shelf'}</th>
                <th className="py-2 text-end font-medium">{isHe ? 'מחיר' : 'Price'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const isCurrent = r.item_code.toUpperCase() === current.toUpperCase()
                const isNewest = i === list.length - 1
                const holdsShelf = !!place && r.place === place && (Number(r.qty) || 0) > 0
                return (
                  <tr key={r.item_code} className={`border-b last:border-0 ${isCurrent ? 'bg-primary/5' : ''}`}>
                    <td className="py-2 pe-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ItemLink code={r.item_code} showCode copyable={false} />
                        {isNewest && (
                          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                            {isHe ? 'חדש ביותר' : 'newest'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pe-3 text-end tabular-nums">{formatNumber(Number(r.qty) || 0)}</td>
                    <td className="py-2 pe-3 font-mono text-xs" dir="ltr">
                      {r.place || '—'}
                      {holdsShelf && list.filter((x) => (Number(x.qty) || 0) > 0).length > 1 && (
                        <span className="ms-1.5 rounded bg-primary/10 px-1 py-px font-sans text-[10px] text-primary">
                          {isHe ? 'מוצג' : 'shown'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-end tabular-nums">{r.price ? formatCurrency(r.price) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="text-xs text-muted-foreground">
                <td className="pt-2 pe-3">{isHe ? 'סה״כ' : 'Total'}</td>
                <td className="pt-2 pe-3 text-end font-semibold tabular-nums text-foreground">{formatNumber(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
