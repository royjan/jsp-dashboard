'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { useConfirmOrder } from '@/hooks/use-suppliers'
import { CheckCircle2, Truck, Package, Clock, Loader2 } from 'lucide-react'

const statusColors: Record<string, 'default' | 'warning' | 'success' | 'secondary' | 'destructive'> = {
  pending: 'warning',
  confirmed: 'default',
  shipped: 'secondary',
  delivered: 'success',
  partial: 'destructive',
}

interface OrderConfirmationProps {
  supplierCode: string
  order: {
    doc_number?: string
    number?: string
    doc_date?: string
    grand_total?: number
    total?: number
    customer_name?: string
    lines?: Array<{
      item_code?: string
      item_name?: string
      quantity?: number
      price?: number
      total?: number
    }>
    confirmation?: {
      status: string
      estimatedDelivery?: string
      confirmedAt?: string
      notes?: string
    } | null
  }
}

export function OrderConfirmation({ supplierCode, order }: OrderConfirmationProps) {
  const { t } = useLocale()
  const [eta, setEta] = useState(order.confirmation?.estimatedDelivery || '')
  const [notes, setNotes] = useState(order.confirmation?.notes || '')
  const [expanded, setExpanded] = useState(false)
  const confirmMutation = useConfirmOrder(supplierCode)

  const docNumber = order.doc_number || order.number || ''
  const status = order.confirmation?.status || 'pending'

  const handleConfirm = () => {
    confirmMutation.mutate({
      documentNumber: docNumber,
      estimatedDelivery: eta,
      notes,
    })
  }

  return (
    <Card className="border">
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">
              {t('suppliers.docNumber')} {docNumber}
            </CardTitle>
            <Badge variant={statusColors[status] || 'secondary'}>
              {t(`suppliers.${status}` as any) || status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {order.doc_date && new Date(order.doc_date).toLocaleDateString('he-IL')}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2">
        {/* Total */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('suppliers.total')}</span>
          <span className="font-medium">
            {(order.grand_total || order.total || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
          </span>
        </div>

        {/* Line items toggle */}
        {order.lines && order.lines.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Package className="h-3 w-3" />
              {order.lines.length} {t('suppliers.lineItems')}
            </button>
            {expanded && (
              <div className="mt-2 rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1 text-start">{t('suppliers.itemCode')}</th>
                      <th className="px-2 py-1 text-start">{t('suppliers.itemName')}</th>
                      <th className="px-2 py-1 text-end">{t('quantity')}</th>
                      <th className="px-2 py-1 text-end">{t('suppliers.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((line, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1 font-mono">{line.item_code}</td>
                        <td className="px-2 py-1">{line.item_name}</td>
                        <td className="px-2 py-1 text-end">{formatNumber(line.quantity)}</td>
                        <td className="px-2 py-1 text-end">
                          {(line.total || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Confirm section */}
        {status === 'pending' && (
          <div className="border-t pt-2 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">
                {t('suppliers.estimatedDelivery')}
              </label>
              <input
                type="date"
                value={eta}
                onChange={e => setEta(e.target.value)}
                className="flex-1 rounded border px-2 py-1 text-xs bg-background"
              />
            </div>
            <div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={t('suppliers.notes')}
                className="w-full rounded border px-2 py-1 text-xs bg-background resize-none"
                rows={2}
              />
            </div>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending || !eta}
              className="w-full"
            >
              {confirmMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin me-1" />
              ) : (
                <CheckCircle2 className="h-3 w-3 me-1" />
              )}
              {t('suppliers.confirmOrder')}
            </Button>
          </div>
        )}

        {/* Confirmed info */}
        {status !== 'pending' && order.confirmation?.estimatedDelivery && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-2">
            <Truck className="h-3.5 w-3.5" />
            <span>
              {t('suppliers.estimatedDelivery')}:{' '}
              {new Date(order.confirmation.estimatedDelivery).toLocaleDateString('he-IL')}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
