'use client'

import { DeliveryCard, statusConfig } from './DeliveryCard'
import type { Delivery } from '@/lib/db/schema'

/* The status colour is an INSET rule, not a border.
 *
 * These were `border-t-4` on a `rounded-xl` column: a 4px bar meeting a 12px
 * radius, so the bar's square ends stick out past the curve at both corners. An
 * inset shadow is clipped by the same radius, follows the curve, and — because it
 * is not part of the box — does not push the column's contents down by 4px. */
const columns: Array<{ status: string; label: string; rule: string }> = [
  { status: 'pending', label: 'ממתין', rule: 'shadow-[inset_0_3px_0_var(--color-gray-300)]' },
  { status: 'assigned', label: 'שויך', rule: 'shadow-[inset_0_3px_0_var(--color-blue-400)]' },
  { status: 'in_transit', label: 'בדרך', rule: 'shadow-[inset_0_3px_0_var(--color-amber-400)]' },
  { status: 'delivered', label: 'נמסר', rule: 'shadow-[inset_0_3px_0_var(--color-emerald-400)]' },
]

interface DeliveryBoardProps {
  deliveries: Delivery[]
  onCardClick?: (delivery: Delivery) => void
}

export function DeliveryBoard({ deliveries, onCardClick }: DeliveryBoardProps) {
  const grouped = columns.map((col) => ({
    ...col,
    items: deliveries.filter((d) => d.status === col.status),
  }))

  // Also collect failed items
  const failed = deliveries.filter((d) => d.status === 'failed')

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {grouped.map((col) => (
        <div
          key={col.status}
          className={`flex-1 min-w-[280px] max-w-[350px] rounded-xl ${col.rule} bg-muted/30 p-3`}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">{col.label}</h3>
            <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">
              {col.items.length}
            </span>
          </div>

          <div className="space-y-2">
            {col.items.map((delivery) => (
              <DeliveryCard
                key={delivery.id}
                delivery={delivery}
                compact
                onClick={() => onCardClick?.(delivery)}
              />
            ))}

            {col.items.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                אין משלוחים
              </p>
            )}
          </div>
        </div>
      ))}

      {/* Failed column - only show if there are failed deliveries */}
      {failed.length > 0 && (
        <div className="flex-1 min-w-[280px] max-w-[350px] rounded-xl shadow-[inset_0_3px_0_var(--color-red-400)] bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm text-red-600 dark:text-red-400">נכשל</h3>
            <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">
              {failed.length}
            </span>
          </div>

          <div className="space-y-2">
            {failed.map((delivery) => (
              <DeliveryCard
                key={delivery.id}
                delivery={delivery}
                compact
                onClick={() => onCardClick?.(delivery)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
