'use client'

import { useMemo, useState, useEffect, Fragment } from 'react'
import { motion } from 'framer-motion'
import {
  useCustomerDetail, useCustomerHistory, useCustomerPurchases,
  useCustomerItemInvoices, useDocumentDetail,
} from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

/** Stable "nothing expanded" value — a fresh Set every render would churn. */
const EMPTY_KEYS: Set<string | number> = new Set()
import { ItemLink } from '@/components/shared/ItemLink'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Receipt,
  ShoppingCart,
  User,
  Wallet,
} from 'lucide-react'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { cardVariants } from '@/lib/motion'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import type { CustomerTab } from './tabs'


// Severity ramp, CVD-validated on the dark surface (90 vs 90+ were previously
// two near-identical reds).
const AGING_COLORS = ['#34d399', '#fde047', '#fb923c', '#f43f5e', '#9f1239']

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
      <Card><CardContent className="p-6"><Skeleton className="w-full h-12" /></CardContent></Card>
    </div>
  )
}

export function CustomerDetailView({ code, initialTab }: { code: string; initialTab?: CustomerTab }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const { data, isLoading, error } = useCustomerDetail(code)
  // Order/receipt/document history loads separately (long FINAPI scans) so the
  // header/KPIs/aging paint immediately instead of waiting ~30s behind it.
  const { data: historyData, isLoading: historyLoading } = useCustomerHistory(code)
  const [purchaseDays, setPurchaseDays] = useState(90)
  const { data: purchasesData, isLoading: purchasesLoading } = useCustomerPurchases(code, purchaseDays)

  // Land on the first tab that actually has data (some customers have invoices
  // but no recent purchases/orders, so the default "purchases" tab looked empty)
  // — unless the URL already named one, which counts as an explicit choice.
  const [tab, setTab] = useState<string>(initialTab ?? 'purchases')
  const [tabTouched, setTabTouched] = useState(!!initialTab)
  useEffect(() => {
    if (tabTouched) return
    const best = (purchasesData?.item_count ?? 0) > 0 ? 'purchases'
      : (historyData?.documents?.length ?? 0) > 0 ? 'documents'
      : (historyData?.orders?.length ?? 0) > 0 ? 'orders'
      : (historyData?.receipts?.length ?? 0) > 0 ? 'receipts'
      : (data?.aging_documents?.length ?? 0) > 0 ? 'unpaid'
      : 'purchases'
    setTab(best)
  }, [purchasesData, historyData, data, tabTouched])

  // replaceState, not router.push: the tab is a view toggle, not a navigation,
  // and pushing would make Back walk the tabs instead of leaving the customer.
  function selectTab(next: string) {
    setTab(next)
    setTabTouched(true)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/customers/${encodeURIComponent(code)}/${next}`)
    }
  }

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-destructive p-4">Error: {(error as Error).message}</div>
  if (!data) return null

  const { profile, balance, aging } = data
  const openDebts: AgingDoc[] = data.aging_documents ?? []
  const orders = historyData?.orders ?? []
  const receipts = historyData?.receipts ?? []
  const documents = historyData?.documents ?? []

  // All five buckets, zeros included. Filtering empty buckets out used to make
  // the whole card vanish for a debt-free customer, which read as a load failure
  // rather than as "no debt".
  const agingData = [
    { name: t('currentDebt'), value: aging.current, color: AGING_COLORS[0] },
    { name: t('overdue30'), value: aging.days_30, color: AGING_COLORS[1] },
    { name: t('overdue60'), value: aging.days_60, color: AGING_COLORS[2] },
    { name: t('overdue90'), value: aging.days_90, color: AGING_COLORS[3] },
    { name: t('overdue90Plus'), value: aging.over_90, color: AGING_COLORS[4] },
  ]
  // The bar still only draws non-zero buckets — a zero segment would render as a
  // stray 1.5px tick of colour.
  const agingSegments = agingData.filter(d => d.value !== 0)
  // abs so a negative bucket (credit) still gets a visible share
  const agingTotal = agingData.reduce((sum, d) => sum + Math.abs(d.value), 0)

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
        <Link
          href={`/bookkeeping/accounts/${encodeURIComponent(String(code).replace(/^0+/, '') || code)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-primary transition-colors hover:bg-accent"
        >
          <BookOpen className="h-3.5 w-3.5" />
          {t('bookkeepingLedgerCard')}
        </Link>
      </div>

      {/* Profile + KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: t('balance'), value: formatCurrency(balance), icon: DollarSign, color: balance > 0 ? 'text-red-600' : 'text-green-600' },
          { label: t('creditLimit'), value: profile?.credit_limit ? formatCurrency(profile.credit_limit) : '-', icon: DollarSign, color: 'text-blue-600' },
          { label: t('paymentTerms'), value: profile?.payment_terms ? `${profile.payment_terms} ${t('daysAgo')}` : '-', icon: Clock, color: 'text-purple-600' },
          { label: t('priceCode'), value: profile?.price_code || '-', icon: FileText, color: 'text-orange-600' },
          { label: t('invoices'), value: historyLoading ? '…' : formatNumber(documents.length), icon: Receipt, color: 'text-teal-600' },
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
      <Card>
        <CardHeader><CardTitle className="text-base">{t('agingBreakdown')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-4 w-full gap-0.5" role="img" aria-label={t('agingBreakdown')}>
            {agingSegments.length === 0 && <div className="w-full rounded-full bg-muted" />}
            {agingSegments.map((b) => (
              <div
                key={b.name}
                className="min-w-1.5 rounded-[3px] first:rounded-s-full last:rounded-e-full"
                style={{ flexGrow: Math.abs(b.value), backgroundColor: b.color }}
                title={`${b.name}: ${formatCurrency(b.value)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {agingData.map((b) => (
              <span key={b.name} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: b.color }} />
                <span className="text-muted-foreground">{b.name}</span>
                <span className="font-medium">{formatCurrency(b.value)}</span>
                <span className="text-muted-foreground">
                  {/* The 1% floor keeps a tiny bucket visible, but must not apply to an
                      empty one — now that zero buckets are always listed, it read as 1%. */}
                  ({b.value !== 0 && agingTotal > 0 ? Math.max(1, Math.round((Math.abs(b.value) / agingTotal) * 100)) : 0}%)
                </span>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Purchases / Orders / Receipts / Documents / Open debts */}
      <Card>
        <Tabs value={tab} onValueChange={selectTab}>
          <CardHeader>
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="purchases" className="gap-1"><ShoppingCart className="h-3.5 w-3.5" />קניות אחרונות ({purchasesData?.item_count ?? 0})</TabsTrigger>
              <TabsTrigger value="orders">{t('recentOrders')} ({historyLoading ? '…' : orders.length})</TabsTrigger>
              <TabsTrigger value="receipts">{t('recentReceipts')} ({historyLoading ? '…' : receipts.length})</TabsTrigger>
              <TabsTrigger value="documents">{t('invoices')} ({historyLoading ? '…' : documents.length})</TabsTrigger>
              <TabsTrigger value="unpaid" className="gap-1">
                <Wallet className="h-3.5 w-3.5" />{t('customer.openDebts')} ({openDebts.length})
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="purchases">
              <PurchasesTable
                customerCode={code}
                data={purchasesData}
                isLoading={purchasesLoading}
                days={purchaseDays}
                onDaysChange={setPurchaseDays}
              />
            </TabsContent>
            <TabsContent value="orders">
              <DocumentTable items={orders} t={t} isLoading={historyLoading} />
            </TabsContent>
            <TabsContent value="receipts">
              <DocumentTable items={receipts} t={t} isReceipt isLoading={historyLoading} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentTable items={documents} t={t} isLoading={historyLoading} expandable caption={t('customer.documentsWindow')} />
            </TabsContent>
            <TabsContent value="unpaid">
              <OpenDebtsTable docs={openDebts} asOf={data.aging_as_of} balance={balance} />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}

// ── Open debts (AR open items) ────────────────────────────────────────────────
// Source: /api/customers/aging?include_documents=true on the .109 box. These are
// the documents that make up the balance — verified 2026-08-22 that their
// amounts sum to net_balance to the shekel. days_overdue/bucket come from the
// ERP; do NOT recompute them from doc_date (payment terms live in Btrieve and
// the customer profile reports them as the raw string "0000").

export interface AgingDoc {
  format: string
  doc_number: string
  doc_date: string
  due_date: string
  days_overdue: number
  bucket: string
  amount: number
}

const BUCKET_COLORS: Record<string, string> = {
  current: AGING_COLORS[0],
  '1_30': AGING_COLORS[1],
  '31_60': AGING_COLORS[2],
  '61_90': AGING_COLORS[3],
  over_90: AGING_COLORS[4],
}

function OpenDebtsTable({ docs, asOf, balance }: { docs: AgingDoc[]; asOf: string | null; balance: number }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const columns: DataTableColumn<AgingDoc>[] = [
    {
      key: 'doc_number',
      header: t('docNumber'),
      sortable: true,
      cell: d => (
        <span className="inline-flex items-center gap-1.5 font-mono">
          <Link
            href={`/documents/${encodeURIComponent(d.format)}/${encodeURIComponent(d.doc_number)}${d.doc_date ? `?year=${d.doc_date.slice(0, 4)}` : ''}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {d.doc_number}
            <ExternalLink className="h-3 w-3" />
          </Link>
          {d.format !== '11' && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              {DOC_TYPE_NAMES[Number(d.format)] || d.format}
            </Badge>
          )}
        </span>
      ),
      exportValue: d => d.doc_number,
    },
    {
      key: 'doc_date',
      header: t('date'),
      sortable: true,
      sortValue: d => d.doc_date ?? '',
      cell: d => <span className="text-muted-foreground">{formatDate(d.doc_date)}</span>,
      exportValue: d => d.doc_date ?? '',
    },
    {
      key: 'days_overdue',
      header: t('customer.daysOverdue'),
      align: 'end',
      sortable: true,
      cell: d => (d.days_overdue > 0 ? formatNumber(d.days_overdue) : '—'),
      exportValue: d => d.days_overdue,
    },
    {
      key: 'bucket',
      header: t('agingBreakdown'),
      sortable: true,
      cell: d => (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: BUCKET_COLORS[d.bucket] ?? AGING_COLORS[0] }}
          />
          <span className="text-muted-foreground">{BUCKET_LABEL(t, d.bucket)}</span>
        </span>
      ),
      exportValue: d => BUCKET_LABEL(t, d.bucket),
    },
    {
      key: 'amount',
      header: t('amount'),
      align: 'end',
      sortable: true,
      cell: d => <span className="font-medium">{formatCurrency(d.amount)}</span>,
      exportValue: d => d.amount,
    },
  ]

  const total = docs.reduce((sum, d) => sum + d.amount, 0)
  // A mismatch means the open items don't explain the balance (unapplied
  // receipts, journal entries) — say so instead of showing a total that
  // contradicts the KPI above.
  const reconciles = Math.abs(total - balance) < 1

  if (docs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">{t('customer.noOpenDebts')}</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] text-muted-foreground">
          {t('customer.openDebtsWindow').replace('{date}', asOf ? formatDate(asOf) : '—')}
        </p>
        <span className="text-xs text-muted-foreground">
          {formatNumber(docs.length)} · {formatCurrency(total)} {t('total')}
          {!reconciles && <span className="text-amber-500 ms-2">≠ {formatCurrency(balance)}</span>}
        </span>
      </div>

      <DataTable<AgingDoc>
        rows={docs}
        columns={columns}
        // A customer can hold the same document number under two formats.
        getRowKey={d => `${d.format}-${d.doc_number}`}
        defaultSort={{ field: 'days_overdue', dir: 'desc' }}
        maxHeight="60vh"
        minWidth="min-w-[620px]"
        density="compact"
        exportFileName="חובות-פתוחים"
      />
    </div>
  )
}

function BUCKET_LABEL(t: (k: any) => string, bucket: string): string {
  switch (bucket) {
    case '1_30': return t('overdue30')
    case '31_60': return t('overdue60')
    case '61_90': return t('overdue90')
    case 'over_90': return t('overdue90Plus')
    default: return t('currentDebt')
  }
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
  customerCode, data, isLoading, days, onDaysChange,
}: {
  customerCode: string; data: any; isLoading: boolean; days: number; onDaysChange: (d: number) => void
}) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const items: PurchaseItem[] = data?.items ?? []
  const DAY_OPTIONS = [30, 60, 90, 180, 365]
  // One at a time: two open invoice panels side by side are two concurrent
  // fetches and a row you have to scroll past to reach the next one.
  const [openItem, setOpenItem] = useState<string | null>(null)

  const columns: DataTableColumn<PurchaseItem>[] = [
    {
      key: 'item_code',
      header: 'קוד',
      sortable: true,
      cell: item => <span className="font-mono text-xs"><ItemLink code={item.item_code} showCode /></span>,
      exportValue: item => item.item_code,
    },
    {
      key: 'item_name',
      header: 'שם פריט',
      sortable: true,
      truncate: 'max-w-[220px]',
      title: item => item.item_name,
      cell: item => <ItemLink code={item.item_code} name={item.item_name} />,
      exportValue: item => item.item_name,
    },
    {
      key: 'total_qty',
      header: 'כמות',
      align: 'end',
      sortable: true,
      cell: item => (
        <>
          {formatNumber(item.total_qty)}
          {item.returned_qty > 0 && (
            <span className="ms-1 text-[10px] text-red-500">(-{formatNumber(item.returned_qty)})</span>
          )}
        </>
      ),
      exportValue: item => item.total_qty,
    },
    {
      key: 'total_value',
      header: 'שווי',
      align: 'end',
      sortable: true,
      cell: item => <span className="font-medium">{formatCurrency(item.total_value)}</span>,
      exportValue: item => item.total_value,
    },
    {
      key: 'line_count',
      header: 'חשבוניות',
      align: 'end',
      sortable: true,
      cell: item => <span className="text-muted-foreground">{formatNumber(item.line_count)}</span>,
      exportValue: item => item.line_count,
    },
    {
      key: 'last_purchased',
      header: 'אחרון',
      align: 'end',
      sortable: true,
      sortValue: item => item.last_purchased ?? '',
      cell: item => (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          {formatDate(item.last_purchased)}
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', openItem === item.item_code && 'rotate-180')}
          />
        </span>
      ),
      exportValue: item => item.last_purchased ?? '',
    },
  ]

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
            {formatNumber(data.item_count ?? 0)} פריטים · {formatCurrency(data.total_value ?? 0)} סה״כ
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('customer.purchasesWindow').replace('{days}', String(days))}</p>

      <DataTable<PurchaseItem>
        rows={items}
        columns={columns}
        getRowKey={item => item.item_code}
        loading={isLoading}
        defaultSort={{ field: 'last_purchased', dir: 'desc' }}
        maxHeight="60vh"
        minWidth="min-w-[680px]"
        density="compact"
        exportFileName={`קניות-${customerCode}`}
        expandedKeys={openItem ? new Set([openItem]) : EMPTY_KEYS}
        onExpandedChange={keys => setOpenItem(([...keys][0] as string) ?? null)}
        renderExpanded={item => (
          <PurchaseItemInvoices
            customerCode={customerCode}
            itemCode={item.item_code}
            days={days}
            // A returned line makes the invoice count unreliable as a
            // completeness check, so it is not asserted in that case.
            expected={item.returned_qty > 0 ? 0 : item.line_count}
          />
        )}
        labels={{ empty: 'אין קניות בתקופה זו' }}
      />
    </div>
  )
}

// ── Purchase drill-down: this year's invoices containing the item ─────────────
// Mounted only while its row is expanded, so the fetch is lazy. Cold cache is a
// long live-lines scan server-side — hence the slow-first-load note.

function PurchaseItemInvoices({ customerCode, itemCode, days, expected }: {
  customerCode: string; itemCode: string; days: number; expected: number
}) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const { data, isLoading, error } = useCustomerItemInvoices(customerCode, itemCode, days, expected)
  const rows: {
    doc_format: string; doc_number: string; doc_date: string
    quantity: number; unit_price: number; discount_percent: number; line_total: number
  }[] = data?.rows ?? []

  if (isLoading) {
    return (
      <div className="p-3 space-y-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        <p className="text-[11px] text-muted-foreground">{t('drilldown.slowFirstLoad')}</p>
      </div>
    )
  }
  if (error || data?.error) {
    return <p className="p-3 text-xs text-destructive">{t('drilldown.loadFailed')}</p>
  }
  if (rows.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">{t('drilldown.noLines')}</p>
  }

  return (
    <div className="p-3 space-y-2">
      <p className="text-[11px] font-medium text-muted-foreground">
        {t('drilldown.invoicesForItem')}
        {/* Irrelevant when the early-exit already found every expected match. */}
        {data?.capped && !(expected > 0 && rows.length >= expected) && (
          <span className="ms-2 text-amber-500">{t('drilldown.partialScan')}</span>
        )}
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground [&>th]:p-1.5 [&>th]:font-normal border-b">
            <th className="text-start">{t('docNumber')}</th>
            <th className="text-start">{t('date')}</th>
            <th className="text-end">{t('quantity')}</th>
            <th className="text-end">{t('drilldown.unitPrice')}</th>
            <th className="text-end">{t('drilldown.discount')}</th>
            <th className="text-end">{t('drilldown.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.doc_format}-${r.doc_number}-${i}`} className="border-b last:border-0">
              <td className="p-1.5 font-mono">
                <span className="inline-flex items-center gap-1.5">
                  <Link
                    href={`/documents/${encodeURIComponent(r.doc_format)}/${encodeURIComponent(r.doc_number)}${r.doc_date ? `?year=${r.doc_date.slice(0, 4)}` : ''}`}
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {r.doc_number}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  {r.doc_format !== '11' && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      {DOC_TYPE_NAMES[Number(r.doc_format)] || r.doc_format}
                    </Badge>
                  )}
                </span>
              </td>
              <td className="p-1.5 text-muted-foreground">{formatDate(r.doc_date)}</td>
              <td className="p-1.5 text-end tabular-nums">{formatNumber(r.quantity)}</td>
              <td className="p-1.5 text-end tabular-nums">{formatCurrency(r.unit_price)}</td>
              <td className="p-1.5 text-end tabular-nums text-muted-foreground">{r.discount_percent ? `${r.discount_percent}%` : '—'}</td>
              <td className="p-1.5 text-end tabular-nums font-medium">{formatCurrency(r.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Document table ─────────────────────────────────────────────────────────────

interface DocRow {
  doc: any
  docNumber: string
  docType: string
  format: string
  year: string
  date: string
  amount: number
  itemCount: number
}

const PAGE_SIZE = 30

function DocumentTable({ items, t, isReceipt, isLoading, expandable, caption }: {
  items: any[]; t: (k: any) => string; isReceipt?: boolean; isLoading?: boolean
  expandable?: boolean; caption?: string
}) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const [openKey, setOpenKey] = useState<string | null>(null)
  const rows: DocRow[] = useMemo(
    () =>
      (items || []).map((doc: any) => {
        const date = doc.date || doc.doc_date || doc.created_at || ''
        return {
          doc,
          docNumber: String(doc.number || doc.doc_number || doc.receipt_number || ''),
          docType: String(DOC_TYPE_NAMES[doc.format || doc.type] || doc.format_name || doc.type || ''),
          format: String(doc.format || doc.type || ''),
          year: String(date).slice(0, 4),
          date,
          amount: doc.total || doc.amount || doc.sum || 0,
          itemCount: doc.line_count || doc.items?.length || 0,
        }
      }),
    [items]
  )

  const columns: DataTableColumn<DocRow>[] = [
    {
      key: 'docNumber',
      header: t('docNumber'),
      sortable: true,
      cell: row =>
        row.docNumber && row.format ? (
          <Link
            href={`/documents/${encodeURIComponent(row.format)}/${encodeURIComponent(row.docNumber)}${row.year ? `?year=${row.year}` : ''}`}
            className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
            title="צפייה במסמך"
          >
            {row.docNumber}
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : (
          <span className="font-mono">{row.docNumber || '-'}</span>
        ),
      exportValue: row => row.docNumber,
    },
    {
      key: 'docType',
      header: t('docType'),
      sortable: true,
      cell: row => <Badge variant="secondary">{row.docType || '-'}</Badge>,
      exportValue: row => row.docType,
    },
    {
      key: 'date',
      header: t('date'),
      sortable: true,
      cell: row => <span className="text-muted-foreground">{formatDate(row.date)}</span>,
      exportValue: row => row.date,
    },
    {
      key: 'amount',
      header: t('amount'),
      align: 'end',
      sortable: true,
      cell: row => <span className="font-medium">{formatCurrency(row.amount)}</span>,
      exportValue: row => row.amount,
    },
    // A receipt has no lines, so the column would be an empty strip.
    ...(isReceipt
      ? []
      : [
          {
            key: 'itemCount',
            header: t('items'),
            align: 'end' as const,
            sortable: true,
            cell: (row: DocRow) => (
              <span className="inline-flex items-center gap-1.5">
                {row.itemCount ? formatNumber(row.itemCount) : '-'}
                {expandable && row.docNumber && row.format && (
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-muted-foreground transition-transform',
                      openKey === `${row.format}-${row.docNumber}` && 'rotate-180',
                    )}
                  />
                )}
              </span>
            ),
            exportValue: (row: DocRow) => row.itemCount,
          },
        ]),
  ]

  if (isLoading) {
    return <div className="space-y-2 py-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
  }

  if (!items || items.length === 0) {
    return <p className="text-muted-foreground text-sm py-4 text-center">-</p>
  }

  return (
    <div className="space-y-2">
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
      <DataTable<DocRow>
        rows={rows}
        columns={columns}
        getRowKey={row => `${row.format}-${row.docNumber}`}
        maxHeight="60vh"
        minWidth="min-w-[560px]"
        density="compact"
        pageSize={PAGE_SIZE}
        exportFileName={caption || 'מסמכים'}
        labels={{
          // The history API caps each list at 250, so a full page means "at
          // least this many" rather than an exact count. Dropping the + would
          // turn a floor into a claim.
          pageRange: (from, to, count) =>
            `${from}–${to} מתוך ${formatNumber(count)}${count >= 250 ? '+' : ''}`,
        }}
        expandedKeys={openKey ? new Set([openKey]) : EMPTY_KEYS}
        onExpandedChange={keys => setOpenKey(([...keys][0] as string) ?? null)}
        // Returning null for a row with no document number is what keeps those
        // rows inert — no caret, no cursor, no click target.
        renderExpanded={row =>
          expandable && row.docNumber && row.format ? (
            <DocumentLinesPanel format={row.format} number={row.docNumber} year={row.year} t={t} />
          ) : null
        }
      />

    </div>
  )
}

// ── Invoice drill-down: the document's line items ─────────────────────────────
// Mounted only while its row is expanded (lazy fetch). Mirrors the columns of
// the standalone document page at app/documents/[format]/[number].

interface DocLine {
  line_number: number
  item_code: string
  item_name: string
  quantity: number
  unit_price: number
  discount_percent: number
  line_total: number
}

function DocumentLinesPanel({ format, number, year, t }: {
  format: string; number: string; year: string; t: (k: string) => string
}) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { data, isLoading, error } = useDocumentDetail(format, number, year || undefined)
  const lines: DocLine[] = data?.lines ?? []

  if (isLoading) {
    return (
      <div className="p-3 space-y-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
      </div>
    )
  }
  if (error || data?.error) {
    return <p className="p-3 text-xs text-destructive">{t('drilldown.loadFailed')}</p>
  }
  if (lines.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground text-center">—</p>
  }

  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground [&>th]:p-1.5 [&>th]:font-normal border-b">
            <th className="text-start">{t('code')}</th>
            <th className="text-start">{t('item')}</th>
            <th className="text-end">{t('quantity')}</th>
            <th className="text-end">{t('drilldown.unitPrice')}</th>
            <th className="text-end">{t('drilldown.discount')}</th>
            <th className="text-end">{t('drilldown.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.line_number}-${i}`} className="border-b last:border-0">
              <td className="p-1.5 font-mono"><ItemLink code={l.item_code} showCode /></td>
              <td className="p-1.5 max-w-[240px] truncate" title={l.item_name}>
                <ItemLink code={l.item_code} name={l.item_name} />
              </td>
              <td className="p-1.5 text-end tabular-nums">{formatNumber(l.quantity)}</td>
              <td className="p-1.5 text-end tabular-nums">{formatCurrency(l.unit_price)}</td>
              <td className="p-1.5 text-end tabular-nums text-muted-foreground">{l.discount_percent ? `${l.discount_percent}%` : '—'}</td>
              <td className="p-1.5 text-end tabular-nums font-medium">{formatCurrency(l.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
