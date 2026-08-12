'use client'

import { useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { useSupplierDetail, useUpdateSupplier, useSupplierOrders, useSupplierShipments } from '@/hooks/use-suppliers'
import {
  Loader2, AlertCircle, ArrowRight, Save,
  Package, TrendingDown, Truck, FileSpreadsheet, Container,
  Mail, Phone, Clock, FileText,
} from 'lucide-react'

/**
 * Shell for a supplier: breadcrumb, profile card and section nav. The sections
 * used to be client-side tabs, so every view shared one URL and nothing was
 * linkable or refresh-safe — /suppliers/<code>/history now addresses one.
 */
export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLocale()
  const { code } = useParams<{ code: string }>()
  const pathname = usePathname()
  const { data, isLoading, isError, refetch } = useSupplierDetail(code)
  // Cheap here: React Query serves the same cache entry the sections use, so
  // these counts cost nothing extra beyond the first fetch.
  const { data: ordersData } = useSupplierOrders(code)
  const { data: shipmentsData } = useSupplierShipments(code)
  const updateMutation = useUpdateSupplier(code)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})

  const profile = data?.profile
  // The Firestore registry is the authoritative name; the stored profile name
  // was often seeded from a junk ERP-derived one.
  const registry = data?.registry
  const displayName = registry?.name || profile?.supplierName || code

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

  const base = `/suppliers/${encodeURIComponent(code)}`
  const sections = [
    { seg: 'pending', icon: Package, label: t('suppliers.pendingOrdersTab'), count: ordersData?.orders?.length },
    { seg: 'shipments', icon: Container, label: t('suppliers.shipments'), count: shipmentsData?.shipments?.length },
    { seg: 'demand', icon: TrendingDown, label: t('suppliers.demandForecast') },
    { seg: 'history', icon: Truck, label: t('suppliers.deliveryHistory') },
    { seg: 'prices', icon: FileSpreadsheet, label: t('suppliers.priceLists') },
  ]

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
            <div className="flex items-center gap-3 flex-wrap">
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
              {[
                { key: 'supplierName', label: t('suppliers.supplierName') },
                { key: 'shipmentTag', label: t('suppliers.shipmentTag'), placeholder: t('suppliers.shipmentTagHint') },
                { key: 'contactEmail', label: t('suppliers.contactEmail'), type: 'email' },
                { key: 'contactPhone', label: t('suppliers.contactPhone') },
                { key: 'leadTimeDays', label: `${t('suppliers.leadTime')} (${t('suppliers.days')})`, type: 'number' },
                { key: 'paymentTerms', label: t('suppliers.paymentTerms') },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-muted-foreground">{f.label}</label>
                  <input
                    type={f.type || 'text'}
                    value={editForm[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setEditForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                  />
                </div>
              ))}
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">{t('suppliers.notes')}</label>
                <textarea
                  value={editForm.notes ?? ''}
                  onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1 resize-none"
                  rows={2}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {profile?.contactEmail && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" /><span>{profile.contactEmail}</span>
                </div>
              )}
              {profile?.contactPhone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" /><span>{profile.contactPhone}</span>
                </div>
              )}
              {profile?.leadTimeDays && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" /><span>{profile.leadTimeDays} {t('suppliers.days')}</span>
                </div>
              )}
              {profile?.paymentTerms && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileText className="h-4 w-4" /><span>{profile.paymentTerms}</span>
                </div>
              )}
              {profile?.notes && (
                <div className="col-span-full text-muted-foreground text-xs mt-1">{profile.notes}</div>
              )}
              {!profile && (
                <div className="col-span-full text-muted-foreground text-xs">
                  לא נמצא פרופיל לספק זה.{' '}
                  <button onClick={startEdit} className="text-primary hover:underline">צור פרופיל</button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section nav — real links, so each view is addressable and shareable. */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {sections.map((s) => {
          const href = `${base}/${s.seg}`
          const active = pathname === href
          return (
            <Link
              key={s.seg}
              href={href}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
              {s.count ? <span className="text-xs opacity-70">({s.count})</span> : null}
            </Link>
          )
        })}
      </div>

      {children}
    </div>
  )
}
