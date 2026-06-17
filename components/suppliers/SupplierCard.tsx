'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/lib/locale-context'
import { Truck, Clock, Package, CheckCircle2 } from 'lucide-react'

interface SupplierCardProps {
  supplier: {
    supplierCode: string
    supplierName: string
    supplierNumber?: string | null
    active: boolean
    leadTimeDays: number | null
    pendingOrders: number
    totalOrders: number
    lastDelivery: string | null
    contactEmail?: string | null
    contactPhone?: string | null
  }
}

export function SupplierCard({ supplier }: SupplierCardProps) {
  const { t } = useLocale()

  return (
    <Link href={`/suppliers/${supplier.supplierCode}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {supplier.supplierNumber && (
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0" title={supplier.supplierName}>
                    #{supplier.supplierNumber}
                  </Badge>
                )}
                <h3 className="font-semibold text-sm truncate" title={supplier.supplierName}>{supplier.supplierName}</h3>
              </div>
              <p className="text-xs text-muted-foreground font-mono">{supplier.supplierCode}</p>
            </div>
            <Badge variant={supplier.active ? 'success' : 'secondary'}>
              {supplier.active ? t('suppliers.confirmed') : 'Inactive'}
            </Badge>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Package className="h-3.5 w-3.5" />
              <span>{supplier.pendingOrders} {t('suppliers.pendingOrders')}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{supplier.leadTimeDays ?? '—'} {t('suppliers.days')}</span>
            </div>
          </div>

          {/* Last delivery */}
          {supplier.lastDelivery && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-t pt-2">
              <Truck className="h-3.5 w-3.5" />
              <span>{t('suppliers.lastDelivery')}: {new Date(supplier.lastDelivery).toLocaleDateString('he-IL')}</span>
            </div>
          )}

          {/* Pending orders indicator */}
          {supplier.pendingOrders > 0 && (
            <div className="flex items-center gap-1.5">
              <Badge variant="warning" className="text-xs">
                {supplier.pendingOrders} {t('suppliers.pending')}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
