'use client'

import { use, useState } from 'react'
import { motion } from 'framer-motion'
import { useItemDetail, useItemDocuments, useItemLinks } from '@/hooks/use-analytics'
import { deriveBrand, brandChipClasses } from '@/lib/brand'
import { ItemLink } from '@/components/shared/ItemLink'
import { PartLinksCard } from '@/components/items/PartLinksCard'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import {
  ArrowLeft, Package, DollarSign, Warehouse, TrendingUp, Tag, MapPin, Calendar, Layers, Hash,
  FileText, X, Link2,
  Car,
  ExternalLink,
} from 'lucide-react'
import { ILS_FORMAT, NUMBER_FORMAT } from '@/lib/constants'

type DocType = 'invoices' | 'quotes' | 'purchases'
const DOC_LABELS: Record<DocType, { he: string; en: string }> = {
  invoices: { he: 'חשבוניות', en: 'Invoices' },
  quotes: { he: 'הצעות מחיר', en: 'Quotes' },
  purchases: { he: 'קניות מספק', en: 'Purchases' },
}

function ItemDocsPanel({ code, type, isHe, onClose }: { code: string; type: DocType; isHe: boolean; onClose: () => void }) {
  const { data, isLoading } = useItemDocuments(code, type)
  const rows: any[] = data?.rows || []
  const label = DOC_LABELS[type]
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          {isHe ? label.he : label.en}
          {!isLoading && <span className="text-xs font-normal text-muted-foreground">({rows.length})</span>}
        </CardTitle>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{isHe ? 'לא נמצאו מסמכים' : 'No documents found'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-start p-2">{isHe ? 'תאריך' : 'Date'}</th>
                  <th className="text-start p-2">{isHe ? 'מסמך' : 'Doc'}</th>
                  <th className="text-start p-2">{isHe ? 'לקוח/ספק' : 'Party'}</th>
                  <th className="text-end p-2">{isHe ? 'כמות' : 'Qty'}</th>
                  <th className="text-end p-2">{isHe ? 'סה"כ' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.doc_number}-${i}`} className="border-b last:border-0">
                    <td className="p-2 whitespace-nowrap tabular-nums">{formatErpDate(r.date)}</td>
                    <td className="p-2 font-mono">{r.doc_number ?? '-'}</td>
                    <td className="p-2 truncate max-w-[200px]" dir="rtl">{r.party || '-'}</td>
                    <td className="p-2 text-end tabular-nums">{NUMBER_FORMAT.format(r.qty)}</td>
                    <td className="p-2 text-end tabular-nums">{r.total ? ILS_FORMAT.format(r.total) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

function formatErpDate(value: string | number | undefined | null): string {
  if (value == null || value === '' || value === '0') return '-'
  const s = String(value).trim()
  // FINAPI returns ISO date strings (e.g. "2017-10-26") — format them directly.
  // (The old code ran these through an Excel-serial conversion: parseInt("2017-
  // 10-26")=2017 → ~1905, which is why every date showed 1905.)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(`${iso[0]}T00:00:00`)
    return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('he-IL')
  }
  // Legacy fallback: a genuine Excel serial number.
  const n = Number(s)
  if (!Number.isFinite(n) || n < 1000) return '-'
  const d = new Date((n - 25569) * 86400000)
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('he-IL')
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
    </div>
  )
}

export default function ItemDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const decodedCode = decodeURIComponent(code)
  const { t, locale } = useLocale()
  const { data, isLoading, error } = useItemDetail(decodedCode)
  const { data: linksData } = useItemLinks(decodedCode)
  const isHe = locale === 'he'
  const [openDocs, setOpenDocs] = useState<DocType | null>(null)
  const toggleDocs = (type: DocType) => setOpenDocs((cur) => (cur === type ? null : type))

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-destructive p-4">Error: {(error as Error).message}</div>
  if (!data) return null

  const salesData = [
    { label: isHe ? 'השנה' : 'This Year', value: data.sold_this_year || 0 },
    { label: isHe ? 'שנה שעברה' : 'Last Year', value: data.sold_last_year || 0 },
    { label: isHe ? 'לפני שנתיים' : '2Y Ago', value: data.sold_2y_ago || 0 },
    { label: isHe ? 'לפני 3 שנים' : '3Y Ago', value: data.sold_3y_ago || 0 },
  ]

  const totalSales = salesData.reduce((sum, s) => sum + s.value, 0)
  const maxSales = Math.max(...salesData.map(s => s.value), 1)

  const displayedCode = data.canonical_code || data.code || decodedCode
  const brand = deriveBrand(displayedCode)
  const partLinks = linksData?.links || []

  // Not in the ERP, but partly's catalog knows it: show what the part IS and, above all,
  // whether an equivalent is something we actually sell — instead of a dead 404.
  if (data.catalog_only) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <button onClick={() => window.history.back()} className="text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <span className="font-mono">{data.code}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${brandChipClasses(data.brand || deriveBrand(data.code))}`}>
                {data.brand || deriveBrand(data.code)}
              </span>
            </h1>
            {data.name && <p className="text-muted-foreground text-sm mt-0.5" dir="auto">{data.name}</p>}
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm">
              {isHe
                ? 'הפריט מופיע בקטלוג היצרן אך לא נמכר אצלנו — אין לו מלאי, מחיר או היסטוריה.'
                : "This part is in the manufacturer's catalog but we don't carry it — no stock, price or history."}
            </p>
            {data.description && (
              <p className="text-xs text-muted-foreground" dir="ltr">{data.description}</p>
            )}
          </CardContent>
        </Card>

        {data.fits?.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Car className="h-4 w-4 text-indigo-500" />
                {isHe ? 'מתאים לרכבים' : 'Fits these vehicles'}
                <Badge variant="secondary" className="text-xs">{data.fits.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {data.fits.map((f: any) => (
                  <li key={f.vin || f.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {f.label}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {f.vin && <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">{f.vin}</span>}
                    {f.schema && (
                      <span className="text-xs text-muted-foreground truncate" dir="auto">{f.schema}</span>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {data.equivalents?.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4 text-cyan-500" />
                {isHe ? 'מק״טים מקבילים' : 'Equivalents'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.equivalents.map((e: any) => (
                <div key={e.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${brandChipClasses(e.brand)}`}>
                    {e.brand}
                  </span>
                  {e.erpCode ? (
                    <>
                      <ItemLink code={e.erpCode} showCode copyable={false} />
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        {isHe ? 'נמכר אצלנו' : 'we sell this'}
                      </span>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-xs">{e.code}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {isHe ? 'קטלוג בלבד' : 'catalog only'}
                      </span>
                    </span>
                  )}
                  {e.name && <span className="text-muted-foreground text-xs" dir="auto">{e.name}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <button onClick={() => window.history.back()} className="text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <span className="font-mono">{displayedCode}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${brandChipClasses(brand)}`}>
              {brand}
            </span>
          </h1>
          {data.name && (
            <p className="text-muted-foreground text-sm mt-0.5" dir="rtl">{data.name}</p>
          )}
        </div>
      </div>

      {/* Cross-brand resolution banner (hierarchy PSA > MG > TOYOTA): the
          requested code is not an ERP item; we show its equivalent from the
          highest-priority linked brand (partly.part_links). */}
      {data.brand_resolution && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${brandChipClasses(data.brand_resolution.requestedBrand)}`}>
            {data.brand_resolution.requestedBrand}
          </span>
          <span className="font-mono" dir="ltr">{data.brand_resolution.requestedCode}</span>
          <span className="text-muted-foreground">
            {isHe ? 'מוצג החלק המקביל' : 'showing the equivalent part'}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${brandChipClasses(data.brand_resolution.resolvedBrand)}`}>
            {data.brand_resolution.resolvedBrand}
          </span>
          <span className="font-mono font-medium" dir="ltr">{data.brand_resolution.resolvedCode}</span>
          {data.brand_resolution.confidence !== 'high' && (
            <span className="text-xs text-muted-foreground" title={isHe ? 'התאמה משוערת' : 'approximate match'}>~</span>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Warehouse className="h-3.5 w-3.5 text-blue-500" />
                {t('stockQty')}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{NUMBER_FORMAT.format(data.stock_qty || 0)}</div>
              <div className="text-xs text-muted-foreground flex gap-2 mt-1">
                {data.ordered_qty > 0 && <span>{isHe ? 'הוזמן' : 'Ordered'}: {data.ordered_qty}</span>}
                {data.incoming_qty > 0 && <span>{isHe ? 'בדרך' : 'Incoming'}: {data.incoming_qty}</span>}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <DollarSign className="h-3.5 w-3.5 text-green-500" />
                {t('price')}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{data.price ? ILS_FORMAT.format(data.price) : '-'}</div>
              {data.import_markup > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  {isHe ? 'מכפיל יבוא' : 'Markup'}: x{data.import_markup}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card
            onClick={() => toggleDocs('invoices')}
            className={`cursor-pointer transition-colors hover:border-primary/50 ${openDocs === 'invoices' ? 'border-primary' : ''}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <TrendingUp className="h-3.5 w-3.5 text-violet-500" />
                {isHe ? 'נמכר השנה' : 'Sold This Year'}
                <FileText className="h-3 w-3 ms-auto opacity-60" />
              </div>
              <div className="text-xl sm:text-2xl font-bold">{NUMBER_FORMAT.format(data.sold_this_year || 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {isHe ? 'סהכ 4 שנים' : 'Total 4Y'}: {totalSales}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <MapPin className="h-3.5 w-3.5 text-amber-500" />
                {isHe ? 'מיקום' : 'Location'}
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono">{data.place || '-'}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Document drill-down (invoices / quotes / purchases for this item) */}
      {openDocs && (
        <ItemDocsPanel
          code={data.canonical_code || data.code || decodedCode}
          type={openDocs}
          isHe={isHe}
          onClose={() => setOpenDocs(null)}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Sales History */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-500" />
              {isHe ? 'היסטוריית מכירות' : 'Sales History'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {salesData.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24 shrink-0">{s.label}</span>
                  <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                    <motion.div
                      className="h-full bg-primary/80 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.value / maxSales) * 100}%` }}
                      transition={{ delay: i * 0.1, duration: 0.5 }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                      {s.value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4 text-blue-500" />
              {isHe ? 'פרטים' : 'Details'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              {data.barcode && (
                <>
                  <dt className="text-muted-foreground">{isHe ? 'ברקוד' : 'Barcode'}</dt>
                  <dd className="font-mono">{data.barcode}</dd>
                </>
              )}
              {data.group && (
                <>
                  <dt className="text-muted-foreground">{isHe ? 'קבוצה' : 'Group'}</dt>
                  <dd>{data.group}</dd>
                </>
              )}
              {data.hs_code && (
                <>
                  <dt className="text-muted-foreground">{isHe ? 'קוד מכס' : 'HS Code'}</dt>
                  <dd className="font-mono">{data.hs_code}</dd>
                </>
              )}
              {data.cross_references_remarks && (
                <>
                  <dt className="text-muted-foreground">{isHe ? 'קודים חלופיים' : 'Cross Ref'}</dt>
                  <dd className="font-mono">{data.cross_references_remarks}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{isHe ? 'מכירה אחרונה' : 'Last Sale'}</dt>
              <dd>{formatErpDate(data.sale_date)}</dd>
              <dt className="text-muted-foreground">{isHe ? 'קניה אחרונה' : 'Last Purchase'}</dt>
              <dd>
                <button
                  onClick={() => toggleDocs('purchases')}
                  className={`inline-flex items-center gap-1 hover:text-primary transition-colors ${openDocs === 'purchases' ? 'text-primary' : ''}`}
                >
                  {formatErpDate(data.purchase_date)}
                  <FileText className="h-3 w-3 opacity-60" />
                </button>
              </dd>
              <dt className="text-muted-foreground">{isHe ? 'ספירה אחרונה' : 'Last Count'}</dt>
              <dd>{formatErpDate(data.count_date)}</dd>
              <dt className="text-muted-foreground">{isHe ? 'פניות' : 'Inquiries'}</dt>
              <dd>
                <button
                  onClick={() => toggleDocs('quotes')}
                  className={`inline-flex items-center gap-1 hover:text-primary transition-colors ${openDocs === 'quotes' ? 'text-primary' : ''}`}
                >
                  {data.inquiry_count || 0}
                  <FileText className="h-3 w-3 opacity-60" />
                </button>
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Categories */}
      {data.categories?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-green-500" />
              {isHe ? 'קטגוריות' : 'Categories'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.categories.map((cat: any, i: number) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  <span className="text-muted-foreground me-1">{cat.group_name}:</span>
                  {cat.value}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cross-brand equivalent parts (partly.part_links) + manual linking */}
      <PartLinksCard code={decodedCode} links={partLinks} isHe={isHe} />

      {/* Item History Chain */}
      {data.item_id_history?.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Hash className="h-4 w-4 text-amber-500" />
              {isHe ? 'שרשרת קודים' : 'Code History'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {data.item_id_history.map((histCode: string, i: number) => (
                <span key={histCode} className="flex items-center gap-2">
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <Badge
                    variant={histCode === (data.canonical_code || data.code) ? 'default' : 'outline'}
                    className="font-mono text-xs"
                  >
                    {histCode}
                  </Badge>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
