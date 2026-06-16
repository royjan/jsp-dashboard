'use client'

import { useState } from 'react'
import { formatNumber } from '@/lib/constants'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { useSuppliers, useCreateSupplier } from '@/hooks/use-suppliers'
import { SupplierCard } from '@/components/suppliers/SupplierCard'
import {
  Truck, Package, AlertTriangle, Users, Plus, Search,
  Loader2, AlertCircle, X,
} from 'lucide-react'

export default function SuppliersPage() {
  const { t } = useLocale()
  const { data, isLoading, isError, refetch } = useSuppliers()
  const createMutation = useCreateSupplier()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    supplierCode: '',
    supplierName: '',
    contactEmail: '',
    contactPhone: '',
    leadTimeDays: '',
    paymentTerms: '',
    notes: '',
  })

  const suppliers = data?.suppliers || []
  const summary = data?.summary || { total: 0, active: 0, pendingOrders: 0, overdueDeliveries: 0 }

  const filtered = search
    ? suppliers.filter((s: any) =>
        s.supplierName.toLowerCase().includes(search.toLowerCase()) ||
        s.supplierCode.toLowerCase().includes(search.toLowerCase())
      )
    : suppliers

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await createMutation.mutateAsync({
      ...form,
      leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
    })
    setShowAdd(false)
    setForm({ supplierCode: '', supplierName: '', contactEmail: '', contactPhone: '', leadTimeDays: '', paymentTerms: '', notes: '' })
  }

  return (
    <div className="flex flex-col gap-4 p-4" dir="rtl">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t('page.suppliers')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            ניהול ספקים, הזמנות ומחירונים
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? <X className="h-4 w-4 me-1" /> : <Plus className="h-4 w-4 me-1" />}
          {showAdd ? 'ביטול' : t('suppliers.addSupplier')}
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('suppliers.totalSuppliers')}</p>
              <p className="text-lg font-bold">{formatNumber(summary.total)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <Truck className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('suppliers.activeSuppliers')}</p>
              <p className="text-lg font-bold">{formatNumber(summary.active)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <Package className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('suppliers.pendingOrders')}</p>
              <p className="text-lg font-bold">{formatNumber(summary.pendingOrders)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="rounded-lg bg-red-500/10 p-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('suppliers.overdueDeliveries')}</p>
              <p className="text-lg font-bold">{formatNumber(summary.overdueDeliveries)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add supplier form */}
      {showAdd && (
        <Card>
          <CardHeader className="p-3 pb-0">
            <CardTitle className="text-sm">{t('suppliers.addSupplier')}</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.supplierCode')}</label>
                <input
                  required
                  value={form.supplierCode}
                  onChange={e => setForm(p => ({ ...p, supplierCode: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                  placeholder="e.g. SUP001"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.supplierName')}</label>
                <input
                  required
                  value={form.supplierName}
                  onChange={e => setForm(p => ({ ...p, supplierName: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.contactEmail')}</label>
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.contactPhone')}</label>
                <input
                  value={form.contactPhone}
                  onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.leadTime')} ({t('suppliers.days')})</label>
                <input
                  type="number"
                  value={form.leadTimeDays}
                  onChange={e => setForm(p => ({ ...p, leadTimeDays: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('suppliers.paymentTerms')}</label>
                <input
                  value={form.paymentTerms}
                  onChange={e => setForm(p => ({ ...p, paymentTerms: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1"
                  placeholder="e.g. שוטף + 60"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">{t('suppliers.notes')}</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm bg-background mt-1 resize-none"
                  rows={2}
                />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin me-1" />
                  ) : null}
                  {createMutation.isPending ? t('suppliers.saving') : t('suppliers.save')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('suppliers.searchPlaceholder')}
          className="w-full rounded-lg border px-9 py-2 text-sm bg-background"
        />
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>טוען ספקים...</span>
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <span>שגיאה בטעינה</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>נסה שוב</Button>
        </div>
      )}

      {/* Supplier cards grid */}
      {!isLoading && !isError && (
        <>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Truck className="h-8 w-8" />
              <span>{t('suppliers.noSuppliers')}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map((supplier: any) => (
                <SupplierCard key={supplier.supplierCode} supplier={supplier} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
