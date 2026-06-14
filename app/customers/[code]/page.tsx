'use client'

import { use } from 'react'
import { motion } from 'framer-motion'
import { useCustomerDetail } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  User, DollarSign, Clock, FileText, Receipt, ArrowLeft, AlertTriangle,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { ILS_FORMAT, NUMBER_FORMAT } from '@/lib/constants'

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

      {/* Tabs: Orders / Receipts / Documents */}
      <Card>
        <Tabs defaultValue="orders">
          <CardHeader>
            <TabsList>
              <TabsTrigger value="orders">{t('recentOrders')} ({orders?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="receipts">{t('recentReceipts')} ({receipts?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="documents">{t('invoices')} ({documents?.length ?? 0})</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
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

function DocumentTable({ items, t, isReceipt }: { items: any[]; t: (k: any) => string; isReceipt?: boolean }) {
  if (!items || items.length === 0) {
    return <p className="text-muted-foreground text-sm py-4 text-center">-</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-start p-2">{t('docNumber')}</th>
            <th className="text-start p-2">{t('docType')}</th>
            <th className="text-start p-2">{t('date')}</th>
            <th className="text-end p-2">{t('amount')}</th>
            {!isReceipt && <th className="text-end p-2">{t('items')}</th>}
          </tr>
        </thead>
        <tbody>
          {items.slice(0, 50).map((doc: any, i: number) => (
            <motion.tr
              key={`${doc.format || doc.type}-${doc.number || doc.doc_number}-${i}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.5), duration: 0.2 }}
              className="border-b hover:bg-muted/50 transition-colors"
            >
              <td className="p-2 font-mono">{doc.number || doc.doc_number || doc.receipt_number || '-'}</td>
              <td className="p-2">
                <Badge variant="secondary">
                  {DOC_TYPE_NAMES[doc.format || doc.type] || doc.format_name || doc.type || '-'}
                </Badge>
              </td>
              <td className="p-2 text-muted-foreground">{doc.date || doc.created_at || '-'}</td>
              <td className="p-2 text-end font-medium">{ILS_FORMAT.format(doc.total || doc.amount || doc.sum || 0)}</td>
              {!isReceipt && <td className="p-2 text-end">{doc.line_count || doc.items?.length || '-'}</td>}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
