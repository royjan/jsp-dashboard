'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLocale } from '@/lib/locale-context'
import { useSupplierDetail, useUpdateSupplier, useSupplierOrders, useSupplierShipments } from '@/hooks/use-suppliers'
import { OrderConfirmation } from '@/components/suppliers/OrderConfirmation'
import { DemandForecast } from '@/components/suppliers/DemandForecast'
import { PriceUploader } from '@/components/suppliers/PriceUploader'
import {
  Loader2, AlertCircle, ArrowRight, Save,
  Package, TrendingDown, Truck, FileSpreadsheet, Container,
  Mail, Phone, Clock, FileText, CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'

export default function SupplierDetailPage() {
  const { t } = useLocale()
  const { code } = useParams<{ code: string }>()
  const { data, isLoading, isError, refetch } = useSupplierDetail(code)
  const { data: ordersData, isLoading: ordersLoading } = useSupplierOrders(code)
  const { data: shipmentsData, isLoading: shipmentsLoading } = useSupplierShipments(code)
  const updateMutation = useUpdateSupplier(code)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2" dir="rtl">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>טוען פרטי ספק...</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3" dir="rtl">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <span>שגיאה בטעינת הספק</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>נסה שוב</Button>
      </div>
    )
  }

  const profile = data?.profile
  // The Firestore registry is the authoritative name; the stored profile name
  // was often seeded from a junk ERP-derived one.
  const registry = data?.registry
  const displayName = registry?.name || profile?.supplierName || code
  const confirmations = data?.confirmations || []
  const pendingOrders = ordersData?.orders || data?.pendingOrders || []
  const uploads = data?.uploads || []
  const shipments = shipmentsData?.shipments || []

  const startEdit = () => {
    setEditing(true)
    setEditForm({
      supplierName: profile?.supplierName || '',
      shipmentTag: profile?.shipmentTag || '',
      contactEmail: profile?.contactEmail || '',
      contactPhone: profile?.contactPhone || '',
      leadTimeDays: profile?.leadTimeDays || '',
      paymentTerms: profile?.paymentTerms || '',
      notes: profile?.notes || '',
    })
  }

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      ...editForm,
      leadTimeDays: editForm.leadTimeDays ? Number(editForm.leadTimeDays) : null,
    })
    setEditing(false)
  }

  const deliveredConfirmations = confirmations.filter(
    (c: any) => c.status === 'delivered' || c.status === 'shipped'
  )

  return (
    <div className="flex flex-col gap-4 p-4" dir="rtl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/suppliers" className="hover:text-foreground transition-colors">
          {t('suppliers')}
        </Link>
        <ArrowRight className="h-3 w-3 rotate-180" />
        <span className="text-foreground">{displayName}</span>
      </div>

      {/* Profile card */}
      <Card>
        <CardHeader className="p-4 pb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">{displayName}</CardTitle>
              {(registry ? registry.active : profile?.active) && <Badge variant="success">פעיל</Badge>}
              {registry?.aliases?.length > 0 && (
                <Badge variant="outline" className="font-mono">
                  {t('suppliers.aliases')}: {registry.aliases.join(', ')}
                </Badge>
              )}
              {profile?.shipmentTag && (
                <Badge variant="outline" className="font-mono">{t('suppliers.shipmentTag')}: {profile.shipmentTag}</Badge>
              )}
              <span className="text-sm text-muted-foreground font-mono">{code}</span>
            </div>
            <Button
              variant={editing ? 'default' : 'outline'}
              size="sm"
              onClick={editing ? handleSave : startEdit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin me-1" />
              ) : editing ? (
                <Save className="h-3 w-3 me-1" />
              ) : null}
              {editing ? t('suppliers.save') : 'ערוך'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {editing ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.supplierName')}</label>
                <input
                  value={editForm.supplierName}
                  onChange={e => setEditForm(p => ({ ...p, supplierName: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.shipmentTag')}</label>
                <input
                  value={editForm.shipmentTag}
                  onChange={e => setEditForm(p => ({ ...p, shipmentTag: e.target.value }))}
                  placeholder={t('suppliers.shipmentTagHint')}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.contactEmail')}</label>
                <input
                  type="email"
                  value={editForm.contactEmail}
                  onChange={e => setEditForm(p => ({ ...p, contactEmail: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.contactPhone')}</label>
                <input
                  value={editForm.contactPhone}
                  onChange={e => setEditForm(p => ({ ...p, contactPhone: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.leadTime')} ({t('suppliers.days')})</label>
                <input
                  type="number"
                  value={editForm.leadTimeDays}
                  onChange={e => setEditForm(p => ({ ...p, leadTimeDays: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.paymentTerms')}</label>
                <input
                  value={editForm.paymentTerms}
                  onChange={e => setEditForm(p => ({ ...p, paymentTerms: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">{t('suppliers.notes')}</label>
                <textarea
                  value={editForm.notes}
                  onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1 resize-none"
                  rows={2}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {profile?.contactEmail && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>{profile.contactEmail}</span>
                </div>
              )}
              {profile?.contactPhone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{profile.contactPhone}</span>
                </div>
              )}
              {profile?.leadTimeDays && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{profile.leadTimeDays} {t('suppliers.days')}</span>
                </div>
              )}
              {profile?.paymentTerms && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span>{profile.paymentTerms}</span>
                </div>
              )}
              {profile?.notes && (
                <div className="col-span-full text-muted-foreground text-xs mt-1">
                  {profile.notes}
                </div>
              )}
              {!profile && (
                <div className="col-span-full text-muted-foreground text-xs">
                  לא נמצא פרופיל לספק זה.{' '}
                  <button onClick={startEdit} className="text-primary hover:underline">
                    צור פרופיל
                  </button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="orders" className="gap-1.5">
            <Package className="h-3.5 w-3.5" />
            {t('suppliers.pendingOrdersTab')}
            {pendingOrders.length > 0 && (
              <Badge variant="warning" className="ms-1 text-xs h-5 min-w-5 justify-center">
                {pendingOrders.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="demand" className="gap-1.5">
            <TrendingDown className="h-3.5 w-3.5" />
            {t('suppliers.demandForecast')}
          </TabsTrigger>
          <TabsTrigger value="shipments" className="gap-1.5">
            <Container className="h-3.5 w-3.5" />
            {t('suppliers.shipments')}
            {shipments.length > 0 && (
              <span className="text-xs text-muted-foreground ms-1">({shipments.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            {t('suppliers.deliveryHistory')}
            {deliveredConfirmations.length > 0 && (
              <span className="text-xs text-muted-foreground ms-1">({deliveredConfirmations.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="prices" className="gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {t('suppliers.priceLists')}
          </TabsTrigger>
        </TabsList>

        {/* Pending Orders */}
        <TabsContent value="orders">
          {ordersLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>טוען הזמנות...</span>
            </div>
          ) : pendingOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Package className="h-6 w-6" />
              <span>{t('suppliers.noOrders')}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingOrders.map((order: any, i: number) => (
                <OrderConfirmation
                  key={order.doc_number || order.number || i}
                  supplierCode={code}
                  order={order}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Demand Forecast */}
        <TabsContent value="demand">
          <DemandForecast supplierCode={code} />
        </TabsContent>

        {/* Inbound shipments — warehouse receiving from the container app.
            Distinct from "delivery history" below, which is ERP order
            confirmations marked delivered/shipped. */}
        <TabsContent value="shipments">
          {shipmentsLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('suppliers.loadingShipments')}</span>
            </div>
          ) : shipments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Container className="h-6 w-6" />
              <span>{t('suppliers.noShipments')}</span>
            </div>
          ) : (
            <div className="rounded border overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.shipmentDate')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.shipmentName')}</th>
                    <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.scanned')}</th>
                    <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.missingQty')}</th>
                    <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.products')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id} className="border-t hover:bg-accent/50">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {typeof s.shipmentDate === 'string' ? s.shipmentDate.slice(0, 10) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/shipments/${encodeURIComponent(s.id)}`} className="hover:underline">
                          {s.name || s.id} ↗
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {s.totalScanned} / {s.totalExpected}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {s.missing > 0
                          ? <span className="text-amber-500 font-semibold">{s.missing}</span>
                          : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{s.uniqueProducts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Delivery History */}
        <TabsContent value="history">
          {deliveredConfirmations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Truck className="h-6 w-6" />
              <span>{t('suppliers.noDeliveries')}</span>
            </div>
          ) : (
            <div className="rounded border overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.docNumber')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.status')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.estimatedDelivery')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.actualDelivery')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.notes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveredConfirmations.map((c: any) => (
                    <tr key={c.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{c.documentNumber}</td>
                      <td className="px-3 py-2">
                        <Badge variant={c.status === 'delivered' ? 'success' : 'secondary'}>
                          {t(`suppliers.${c.status}` as any) || c.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {c.estimatedDelivery ? new Date(c.estimatedDelivery).toLocaleDateString('he-IL') : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {c.actualDelivery ? new Date(c.actualDelivery).toLocaleDateString('he-IL') : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Price Lists */}
        <TabsContent value="prices">
          <PriceUploader supplierCode={code} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
