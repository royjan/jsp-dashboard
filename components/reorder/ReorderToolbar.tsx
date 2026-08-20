'use client'

import { Sparkles, Trash2, Package, CheckCircle, Truck, ClipboardList, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useGenerateSuggestions, useClearReceived } from '@/hooks/use-reorder-queue'
import type { ReorderQueueData } from '@/hooks/use-reorder-queue'
import { formatCurrency } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'

interface ReorderToolbarProps {
  data: ReorderQueueData | undefined
}

export function ReorderToolbar({ data }: ReorderToolbarProps) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const generate = useGenerateSuggestions()
  const clearReceived = useClearReceived()

  const counts = {
    suggested: data?.suggested.length ?? 0,
    approved: data?.approved.length ?? 0,
    ordered: data?.ordered.length ?? 0,
    received: data?.received.length ?? 0,
  }

  const totalItems = counts.suggested + counts.approved + counts.ordered + counts.received

  // Estimate cost (suggested + approved items * price * qty)
  const estimatedCost = data
    ? [...(data.suggested ?? []), ...(data.approved ?? [])].reduce((sum, item) => {
        const qty = item.approvedQty ?? item.suggestedQty
        const price = Number(item.price) || 0
        return sum + qty * price
      }, 0)
    : 0

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4" dir="rtl">
      {/* Stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4" />
          <span>{totalItems} פריטים</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="gap-1 text-blue-700 dark:text-blue-400 bg-blue-500/10">
            <Sparkles className="h-3 w-3" />
            {counts.suggested} מוצע
          </Badge>
          <Badge variant="secondary" className="gap-1 text-amber-700 dark:text-amber-400 bg-amber-500/10">
            <CheckCircle className="h-3 w-3" />
            {counts.approved} מאושר
          </Badge>
          <Badge variant="secondary" className="gap-1 text-purple-700 dark:text-purple-400 bg-purple-500/10">
            <Truck className="h-3 w-3" />
            {counts.ordered} הוזמן
          </Badge>
          <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10">
            <Package className="h-3 w-3" />
            {counts.received} התקבל
          </Badge>
        </div>

        {estimatedCost > 0 && (
          <span className="text-xs text-muted-foreground">
            עלות משוערת: {formatCurrency(estimatedCost)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          size="sm"
          className="gap-1.5"
        >
          {generate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          צור המלצות חדשות
        </Button>

        {counts.received > 0 && (
          <Button
            onClick={() => clearReceived.mutate()}
            disabled={clearReceived.isPending}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            {clearReceived.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            נקה התקבלו ({counts.received})
          </Button>
        )}
      </div>

      {/* Status messages */}
      {generate.isSuccess && generate.data && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400">
          {generate.data.message}
        </div>
      )}
      {generate.isError && (
        <div className="text-xs text-destructive">
          שגיאה ביצירת המלצות. נסה שוב.
        </div>
      )}
    </div>
  )
}
