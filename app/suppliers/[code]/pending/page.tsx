'use client'

import { useParams } from 'next/navigation'
import { useLocale } from '@/lib/locale-context'
import { useSupplierDetail, useSupplierOrders } from '@/hooks/use-suppliers'
import { OrderConfirmation } from '@/components/suppliers/OrderConfirmation'
import { Loader2, Package } from 'lucide-react'

export default function SupplierPendingPage() {
  const { t } = useLocale()
  const { code } = useParams<{ code: string }>()
  const { data } = useSupplierDetail(code)
  const { data: ordersData, isLoading } = useSupplierOrders(code)

  const pendingOrders = ordersData?.orders || data?.pendingOrders || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>טוען הזמנות...</span>
      </div>
    )
  }

  if (pendingOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
        <Package className="h-6 w-6" />
        <span>{t('suppliers.noOrders')}</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {pendingOrders.map((order: Record<string, unknown>, i: number) => (
        <OrderConfirmation
          key={(order.doc_number as string) || (order.number as string) || i}
          supplierCode={code}
          order={order}
        />
      ))}
    </div>
  )
}
