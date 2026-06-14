'use client'

import { MapPin, User, FileText, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useState } from 'react'
import type { Delivery } from '@/lib/db/schema'

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'ממתין', color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200' },
  assigned: { label: 'שויך', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  in_transit: { label: 'בדרך', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  delivered: { label: 'נמסר', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  failed: { label: 'נכשל', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
}

interface DeliveryCardProps {
  delivery: Delivery
  compact?: boolean
  onStatusChange?: (id: string, status: string) => void
  onDriverAssign?: (id: string, driver: string) => void
  onClick?: () => void
}

export function DeliveryCard({ delivery, compact = false, onClick }: DeliveryCardProps) {
  const [expanded, setExpanded] = useState(false)
  const config = statusConfig[delivery.status] || statusConfig.pending

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardContent className={compact ? 'p-3' : 'p-4'}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm truncate">{delivery.customerName || 'ללא שם'}</span>
              <Badge className={`text-xs shrink-0 ${config.color}`}>
                {config.label}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono">{delivery.documentNumber}</span>
            </div>

            {delivery.customerAddress && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{delivery.customerAddress}</span>
              </div>
            )}

            {delivery.driverName && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span>{delivery.driverName}</span>
              </div>
            )}
          </div>

          {!compact && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(!expanded)
              }}
              className="p-1 rounded hover:bg-muted"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>

        {expanded && !compact && (
          <div className="mt-3 pt-3 border-t space-y-2 text-sm">
            {delivery.customerCode && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">קוד לקוח</span>
                <span className="font-mono">{delivery.customerCode}</span>
              </div>
            )}
            {delivery.createdAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">נוצר</span>
                <span>{new Date(delivery.createdAt).toLocaleString('he-IL')}</span>
              </div>
            )}
            {delivery.deliveredAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">נמסר</span>
                <span>{new Date(delivery.deliveredAt).toLocaleString('he-IL')}</span>
              </div>
            )}
            {delivery.notes && (
              <div className="text-muted-foreground">
                <span className="font-medium">הערות: </span>
                {delivery.notes}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export { statusConfig }
