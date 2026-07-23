'use client'

import { use, useMemo, useState, useEffect, Fragment } from 'react'
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
import { useSortable, SortableTh } from '@/components/shared/sortable-table'
import { ItemLink } from '@/components/shared/ItemLink'
import Link from 'next/link'
import {
  User, DollarSign, Clock, FileText, Receipt, ArrowLeft, AlertTriangle, ShoppingCart, ExternalLink,
  ChevronDown,
} from 'lucide-react'
import { ILS_FORMAT, NUMBER_FORMAT, formatNumber } from '@/lib/constants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

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

export default function CustomerDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const { t } = useLocale()
  const { data, isLoading, error } = useCustomerDetail(code)
  // Order/receipt/document history loads separately (long FINAPI scans) so the
  // header/KPIs/aging paint immediately instead of waiting ~30s behind it.
  const { data: historyData, isLoading: historyLoading } = useCustomerHistory(code)
  const [purchaseDays, setPurchaseDays] = useState(90)
  const { data: purchasesData, isLoading: purchasesLoading } = useCustomerPurchases(code, purchaseDays)

  // Land on the first tab that actually has data (some customers have invoices
  // but no recent purchases/orders, so the default "purchases" tab looked empty).
  const [tab, setTab] = useState('purchases')
  const [tabTouched, setTabTouched] = useState(false)
  useEffect(() => {
    if (tabTouched) return
    const best = (purchasesData?.item_count ?? 0) > 0 ? 'purchases'
      : (historyData?.documents?.length ?? 0) > 0 ? 'documents'
      : (historyData?.orders?.length ?? 0) > 0 ? 'orders'
      : (historyData?.receipts?.length ?? 0) > 0 ? 'receipts'
      : 'purchases'
    setTab(best)
  }, [purchasesData, historyData, tabTouched])

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-destructive p-4">Error: {(error as Error).message}</div>
  if (!data) return null

  const { profile, balance, aging } = data
  const orders = historyData?.orders ?? []
  const receipts = historyData?.receipts ?? []
  const documents = historyData?.documents ?? []

  const agingData = [
    { name: t('currentDebt'), value: aging.current, color: AGING_COLORS[0] },
    { name: t('overdue30'), value: aging.days_30, color: AGING_COLORS[1] },
    { name: t('overdue60'), value: aging.days_60, color: AGING_COLORS[2] },
    { name: t('overdue90'), value: aging.days_90, color: AGING_COLORS[3] },
    { name: t('overdue90Plus'), value: aging.over_90, color: AGING_COLORS[4] },
  ].filter(d => d.value !== 0)
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
      </div>

      {/* Profile + KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: t('balance'), value: ILS_FORMAT.format(balance), icon: DollarSign, color: balance > 0 ? 'text-red-600' : 'text-green-600' },
          { label: t('creditLimit'), value: profile?.credit_limit ? ILS_FORMAT.format(profile.credit_limit) : '-', icon: DollarSign, color: 'text-blue-600' },
          { label: t('paymentTerms'), value: profile?.payment_terms ? `${profile.payment_terms} ${t('daysAgo')}` : '-', icon: Clock, color: 'text-purple-600' },
          { label: t('priceCode'), value: profile?.price_code || '-', icon: FileText, color: 'text-orange-600' },
          { label: t('invoices'), value: historyLoading ? '…' : NUMBER_FORMAT.format(documents.length), icon: Receipt, color: 'text-teal-600' },
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
          <CardContent className="space-y-3">
            <div className="flex h-4 w-full gap-0.5" role="img" aria-label={t('agingBreakdown')}>
              {agingData.map((b) => (
                <div
                  key={b.name}
                  className="min-w-1.5 rounded-[3px] first:rounded-s-full last:rounded-e-full"
                  style={{ flexGrow: Math.abs(b.value), backgroundColor: b.color }}
                  title={`${b.name}: ${ILS_FORMAT.format(b.value)}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {agingData.map((b) => (
                <span key={b.name} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: b.color }} />
                  <span className="text-muted-foreground">{b.name}</span>
                  <span className="font-medium">{ILS_FORMAT.format(b.value)}</span>
                  <span className="text-muted-foreground">
                    ({agingTotal > 0 ? Math.max(1, Math.round((Math.abs(b.value) / agingTotal) * 100)) : 0}%)
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs: Orders / Receipts / Documents / Purchases */}
      <Card>
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setTabTouched(true) }}>
          <CardHeader>
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="purchases" className="gap-1"><ShoppingCart className="h-3.5 w-3.5" />קניות אחרונות ({purchasesData?.item_count ?? 0})</TabsTrigger>
              <TabsTrigger value="orders">{t('recentOrders')} ({historyLoading ? '…' : orders.length})</TabsTrigger>
              <TabsTrigger value="receipts">{t('recentReceipts')} ({historyLoading ? '…' : receipts.length})</TabsTrigger>
              <TabsTrigger value="documents">{t('invoices')} ({historyLoading ? '…' : documents.length})</TabsTrigger>
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
  customerCode, data, isLoading, days, onDaysChange,
}: {
  customerCode: string; data: any; isLoading: boolean; days: number; onDaysChange: (d: number) => void
}) {
  const { t } = useLocale()
  const items: PurchaseItem[] = data?.items ?? []
  const { sorted, sortKey, sortDir, toggleSort } = useSortable<PurchaseItem>(items, { key: 'last_purchased', dir: 'desc' })
  const DAY_OPTIONS = [30, 60, 90, 180, 365]
  const [openItem, setOpenItem] = useState<string | null>(null)

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
      <p className="text-[11px] text-muted-foreground">{t('customer.purchasesWindow').replace('{days}', String(days))}</p>

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
              {sorted.map(item => {
                const open = openItem === item.item_code
                return (
                  <Fragment key={item.item_code}>
                    <tr
                      className="border-b last:border-0 hover:bg-accent/40 cursor-pointer"
                      aria-expanded={open}
                      onClick={() => setOpenItem(open ? null : item.item_code)}
                    >
                      <td className="p-2 font-mono text-xs" onClick={(e) => e.stopPropagation()}><ItemLink code={item.item_code} showCode /></td>
                      <td className="p-2 max-w-[220px] truncate" title={item.item_name} onClick={(e) => e.stopPropagation()}>
                        <ItemLink code={item.item_code} name={item.item_name} />
                      </td>
                      <td className="p-2 text-end tabular-nums">
                        {formatNumber(item.total_qty)}
                        {item.returned_qty > 0 && <span className="text-red-500 text-[10px] ms-1">(-{formatNumber(item.returned_qty)})</span>}
                      </td>
                      <td className="p-2 text-end tabular-nums font-medium">{ILS_FORMAT.format(item.total_value)}</td>
                      <td className="p-2 text-end tabular-nums text-muted-foreground">{formatNumber(item.line_count)}</td>
                      <td className="p-2 text-end tabular-nums text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {item.last_purchased?.slice(0, 10) || '—'}
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b last:border-0">
                        <td colSpan={6} className="bg-muted/30 p-0">
                          <PurchaseItemInvoices
                            customerCode={customerCode}
                            itemCode={item.item_code}
                            days={days}
                            expected={item.returned_qty > 0 ? 0 : item.line_count}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Purchase drill-down: this year's invoices containing the item ─────────────
// Mounted only while its row is expanded, so the fetch is lazy. Cold cache is a
// long live-lines scan server-side — hence the slow-first-load note.

function PurchaseItemInvoices({ customerCode, itemCode, days, expected }: {
  customerCode: string; itemCode: string; days: number; expected: number
}) {
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
              <td className="p-1.5 text-muted-foreground">{(r.doc_date || '—').slice(0, 10)}</td>
              <td className="p-1.5 text-end tabular-nums">{formatNumber(r.quantity)}</td>
              <td className="p-1.5 text-end tabular-nums">{ILS_FORMAT.format(r.unit_price)}</td>
              <td className="p-1.5 text-end tabular-nums text-muted-foreground">{r.discount_percent ? `${r.discount_percent}%` : '—'}</td>
              <td className="p-1.5 text-end tabular-nums font-medium">{ILS_FORMAT.format(r.line_total)}</td>
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
  const [page, setPage] = useState(0)
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

  const { sorted, sortKey, sortDir, toggleSort } = useSortable<DocRow>(rows)

  if (isLoading) {
    return <div className="space-y-2 py-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
  }

  if (!items || items.length === 0) {
    return <p className="text-muted-foreground text-sm py-4 text-center">-</p>
  }

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const start = current * PAGE_SIZE
  const pageRows = sorted.slice(start, start + PAGE_SIZE)

  return (
    <div className="space-y-2">
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
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
            {pageRows.map((row: DocRow, i: number) => {
              const doc = row.doc
              const rowKey = `${row.format}-${row.docNumber}`
              const canExpand = !!(expandable && row.docNumber && row.format)
              const open = canExpand && openKey === rowKey
              return (
                <Fragment key={`${doc.format || doc.type}-${doc.number || doc.doc_number}-${start + i}`}>
                  <tr
                    className={cn('border-b hover:bg-muted/50 transition-colors', canExpand && 'cursor-pointer')}
                    aria-expanded={canExpand ? open : undefined}
                    onClick={canExpand ? () => setOpenKey(open ? null : rowKey) : undefined}
                  >
                    <td className="p-2 font-mono" onClick={(e) => e.stopPropagation()}>
                      {row.docNumber && row.format ? (
                        <Link
                          href={`/documents/${encodeURIComponent(row.format)}/${encodeURIComponent(row.docNumber)}${row.year ? `?year=${row.year}` : ''}`}
                          className="text-primary hover:underline inline-flex items-center gap-1"
                          title="צפייה במסמך"
                        >
                          {row.docNumber}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : (
                        row.docNumber || '-'
                      )}
                    </td>
                    <td className="p-2">
                      <Badge variant="secondary">{row.docType || '-'}</Badge>
                    </td>
                    <td className="p-2 text-muted-foreground">{(row.date || '-').slice(0, 10)}</td>
                    <td className="p-2 text-end font-medium">{ILS_FORMAT.format(row.amount)}</td>
                    {!isReceipt && (
                      <td className="p-2 text-end">
                        <span className="inline-flex items-center gap-1.5">
                          {row.itemCount ? formatNumber(row.itemCount) : '-'}
                          {canExpand && <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />}
                        </span>
                      </td>
                    )}
                  </tr>
                  {open && (
                    <tr className="border-b">
                      <td colSpan={isReceipt ? 4 : 5} className="bg-muted/30 p-0">
                        <DocumentLinesPanel format={row.format} number={row.docNumber} year={row.year} t={t} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
        {/* The history API caps at 250 per list — a full page means "at least this many". */}
        <span>{start + 1}–{Math.min(start + PAGE_SIZE, total)} מתוך {formatNumber(total)}{total >= 250 ? '+' : ''}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setOpenKey(null); setPage(Math.max(0, current - 1)) }}
            disabled={current === 0}
            className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-accent"
          >
            הקודם
          </button>
          <span className="px-1">{current + 1}/{pageCount}</span>
          <button
            onClick={() => { setOpenKey(null); setPage(Math.min(pageCount - 1, current + 1)) }}
            disabled={current >= pageCount - 1}
            className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-accent"
          >
            הבא
          </button>
        </div>
      </div>
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
              <td className="p-1.5 text-end tabular-nums">{ILS_FORMAT.format(l.unit_price)}</td>
              <td className="p-1.5 text-end tabular-nums text-muted-foreground">{l.discount_percent ? `${l.discount_percent}%` : '—'}</td>
              <td className="p-1.5 text-end tabular-nums font-medium">{ILS_FORMAT.format(l.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
