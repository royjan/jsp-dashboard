'use client'

import { use, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useCustomerDetail, useCustomerPurchases } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useSortable, SortableTh } from '@/components/shared/sortable-table'
import Link from 'next/link'
import {
  User, DollarSign, Clock, FileText, Receipt, ArrowLeft, AlertTriangle, ShoppingCart,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { ILS_FORMAT, NUMBER_FORMAT, formatNumber } from '@/lib/constants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

const AGING_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#dc2626']

const DOC_TYPE_NAMES: Record<number, string> = {
  11: 'Tax Invoice',
  12: 'Credit Note',
  21: 'Delivery Note',
  31: 'Quote',
  1: 'Receipt',
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-6"><Skeleton className="w-full h-[200px]" /></CardContent></Card>
    </div>
  )
}

export default function CustomerDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const { t } = useLocale()
  const { data, isLoading, error } = useCustomerDetail(code)
  const [purchaseDays, setPurchaseDays] = useState(90)
  const { data: purchasesData, isLoading: purchasesLoading } = useCustomerPurchases(code, purchaseDays)

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-destructive p-4">Error: {(error as Error).message}</div>
  if (!data) return null

  const { profile, balance, aging, orders, receipts, documents } = data

  const agingData = [
    { name: t('currentDebt'), value: aging.current, color: AGING_COLORS[0] },
    { name: t('overdue30'), value: aging.days_30, color: AGING_COLORS[1] },
    { name: t('overdue60'), value: aging.days_60, color: AGING_COLORS[2] },
    { name: t('overdue90'), value: aging.days_90, color: AGING_COLORS[3] },
    { name: t('overdue90Plus'), value: aging.over_90, color: AGING_COLORS[4] },
  ].filter(d => d.value !== 0)

  const hasOverdue = aging.days_30 > 0 || aging.days_60 > 0 || aging.days_90 > 0 || aging.over_90 > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <Link href="/customers" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold truncate">{profile?.name || code}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">{code} {profile?.agent_name ? `— ${profile.agent_name}` : ''}</p>
        </div>
        {hasOverdue && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> {t('overdueCustomers')}</Badge>}
      </div>

      {/* Profile + KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: t('balance'), value: ILS_FORMAT.format(balance), icon: DollarSign, color: balance > 0 ? 'text-red-600' : 'text-green-600' },
          { label: t('creditLimit'), value: profile?.credit_limit ? ILS_FORMAT.format(profile.credit_limit) : '-', icon: DollarSign, color: 'text-blue-600' },
          { label: t('paymentTerms'), value: profile?.payment_terms ? `${profile.payment_terms} ${t('daysAgo')}` : '-', icon: Clock, color: 'text-purple-600' },
          { label: t('priceCode'), value: profile?.price_code || '-', icon: FileText, color: 'text-orange-600' },
          { label: t('invoices'), value: NUMBER_FORMAT.format(documents?.length ?? 0), icon: Receipt, color: 'text-teal-600' },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} custom={i} variants={cardVariants} initial="hidden" animate="visible">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <kpi.icon className={cn('h-3.5 w-3.5', kpi.color)} />
                  {kpi.label}
                </div>
                <div className="text-lg font-bold">{kpi.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Aging Chart */}
      {agingData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('agingBreakdown')}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={agingData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => ILS_FORMAT.format(v)} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => ILS_FORMAT.format(v as number)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {agingData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabs: Orders / Receipts / Documents / Purchases */}
      <Card>
        <Tabs defaultValue="purchases">
          <CardHeader>
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="purchases" className="gap-1"><ShoppingCart className="h-3.5 w-3.5" />קניות אחרונות ({purchasesData?.item_count ?? 0})</TabsTrigger>
              <TabsTrigger value="orders">{t('recentOrders')} ({orders?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="receipts">{t('recentReceipts')} ({receipts?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="documents">{t('invoices')} ({documents?.length ?? 0})</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="purchases">
              <PurchasesTable
                data={purchasesData}
                isLoading={purchasesLoading}
                days={purchaseDays}
                onDaysChange={setPurchaseDays}
              />
            </TabsContent>
            <TabsContent value="orders">
              <DocumentTable items={orders} t={t} />
            </TabsContent>
            <TabsContent value="receipts">
              <DocumentTable items={receipts} t={t} isReceipt />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentTable items={documents} t={t} />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}

// ── Recent purchases table ────────────────────────────────────────────────────

interface PurchaseItem {
  item_code: string
  item_name: string
  total_qty: number
  total_value: number
  line_count: number
  last_purchased: string
  returned_qty: number
}

function PurchasesTable({
  data, isLoading, days, onDaysChange,
}: {
  data: any; isLoading: boolean; days: number; onDaysChange: (d: number) => void
}) {
  const items: PurchaseItem[] = data?.items ?? []
  const { sorted, sortKey, sortDir, toggleSort } = useSortable<PurchaseItem>(items)
  const DAY_OPTIONS = [30, 60, 90, 180, 365]

  return (
    <div className="space-y-3">
      {/* Period selector + summary */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                d === days
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
            >{d} יום</button>
          ))}
        </div>
        {data && (
          <span className="text-xs text-muted-foreground">
            {formatNumber(data.item_count ?? 0)} פריטים · {ILS_FORMAT.format(data.total_value ?? 0)} סה״כ
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">אין קניות בתקופה זו</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b text-muted-foreground [&>th]:p-2">
                <SortableTh<PurchaseItem> label="קוד" sortKey="item_code" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh<PurchaseItem> label="שם פריט" sortKey="item_name" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh<PurchaseItem> label="כמות" sortKey="total_qty" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh<PurchaseItem> label="שווי" sortKey="total_value" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh<PurchaseItem> label="חשבוניות" sortKey="line_count" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortableTh<PurchaseItem> label="אחרון" sortKey="last_purchased" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => (
                <tr key={item.item_code} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="p-2 font-mono text-xs">{item.item_code}</td>
                  <td className="p-2 max-w-[220px] truncate" title={item.item_name}>{item.item_name}</td>
                  <td className="p-2 text-end tabular-nums">
                    {formatNumber(item.total_qty)}
                    {item.returned_qty > 0 && <span className="text-red-500 text-[10px] ms-1">(-{formatNumber(item.returned_qty)})</span>}
                  </td>
                  <td className="p-2 text-end tabular-nums font-medium">{ILS_FORMAT.format(item.total_value)}</td>
                  <td className="p-2 text-end tabular-nums text-muted-foreground">{formatNumber(item.line_count)}</td>
                  <td className="p-2 text-end tabular-nums text-muted-foreground">{item.last_purchased?.slice(0, 10) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Document table ─────────────────────────────────────────────────────────────

interface DocRow {
  doc: any
  docNumber: string
  docType: string
  date: string
  amount: number
  itemCount: number
}

function DocumentTable({ items, t, isReceipt }: { items: any[]; t: (k: any) => string; isReceipt?: boolean }) {
  const rows: DocRow[] = useMemo(
    () =>
      (items || []).slice(0, 50).map((doc: any) => ({
        doc,
        docNumber: String(doc.number || doc.doc_number || doc.receipt_number || ''),
        docType: String(DOC_TYPE_NAMES[doc.format || doc.type] || doc.format_name || doc.type || ''),
        date: doc.date || doc.created_at || '',
        amount: doc.total || doc.amount || doc.sum || 0,
        itemCount: doc.line_count || doc.items?.length || 0,
      })),
    [items]
  )

  const { sorted, sortKey, sortDir, toggleSort } = useSortable<DocRow>(rows)

  if (!items || items.length === 0) {
    return <p className="text-muted-foreground text-sm py-4 text-center">-</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground [&>th]:p-2">
            <SortableTh<DocRow> label={t('docNumber')} sortKey="docNumber" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh<DocRow> label={t('docType')} sortKey="docType" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh<DocRow> label={t('date')} sortKey="date" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh<DocRow> label={t('amount')} sortKey="amount" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            {!isReceipt && <SortableTh<DocRow> label={t('items')} sortKey="itemCount" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row: DocRow, i: number) => {
            const doc = row.doc
            return (
              <motion.tr
                key={`${doc.format || doc.type}-${doc.number || doc.doc_number}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.5), duration: 0.2 }}
                className="border-b hover:bg-muted/50 transition-colors"
              >
                <td className="p-2 font-mono">{row.docNumber || '-'}</td>
                <td className="p-2">
                  <Badge variant="secondary">{row.docType || '-'}</Badge>
                </td>
                <td className="p-2 text-muted-foreground">{row.date || '-'}</td>
                <td className="p-2 text-end font-medium">{ILS_FORMAT.format(row.amount)}</td>
                {!isReceipt && <td className="p-2 text-end">{row.itemCount ? formatNumber(row.itemCount) : '-'}</td>}
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
