'use client'

import { use, useState } from 'react'
import { motion } from 'framer-motion'
import { useItemDetail, useItemDocuments, useItemLinks, useItemMedia, HttpError } from '@/hooks/use-analytics'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { deriveBrand, brandChipClasses } from '@/lib/brand'
import { ItemLink } from '@/components/shared/ItemLink'
import { PartLinksCard } from '@/components/items/PartLinksCard'
import { PartMediaCard } from '@/components/items/PartMediaCard'
import { SupplierPricesCard } from '@/components/xpart/SupplierPricesCard'
import { ItemAliasesCard } from '@/components/xpart/ItemAliasesCard'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowLeft, ArrowRight, Package, DollarSign, Warehouse, TrendingUp, Tag, MapPin, Calendar, Layers, Hash,
  FileText, X, Link2,
  Car,
  ChevronDown,
  ExternalLink,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cardVariants } from '@/lib/motion'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { openCommandPalette } from '@/lib/command-palette'

type DocType = 'invoices' | 'quotes' | 'purchases'
const DOC_LABELS: Record<DocType, { he: string; en: string }> = {
  invoices: { he: 'חשבוניות', en: 'Invoices' },
  quotes: { he: 'הצעות מחיר', en: 'Quotes' },
  purchases: { he: 'קניות מספק', en: 'Purchases' },
}

/** One movement of this item — a line off an invoice, order or delivery note. */
interface MovementRow {
  date: string | null
  doc_number: string | null
  party: string | null
  qty: number
  total: number | null
}

function ItemDocsPanel({ code, type, isHe, onClose }: { code: string; type: DocType; isHe: boolean; onClose: () => void }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { data, isLoading } = useItemDocuments(code, type)
  const rows: MovementRow[] = data?.rows ?? []
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
            <DataTable<MovementRow>
              rows={rows}
              columns={[
                {
                  key: 'date',
                  header: isHe ? 'תאריך' : 'Date',
                  sortable: true,
                  // The ERP date is sortable as stored; formatErpDate() renders
                  // it dd/mm/yyyy, which does not sort chronologically.
                  sortValue: r => r.date ?? '',
                  cell: r => <span className="whitespace-nowrap">{formatErpDate(r.date)}</span>,
                  exportValue: r => r.date ?? '',
                },
                {
                  key: 'doc_number',
                  header: isHe ? 'מסמך' : 'Doc',
                  sortable: true,
                  cell: r => <span className="font-mono">{r.doc_number ?? '-'}</span>,
                  exportValue: r => r.doc_number ?? '',
                },
                {
                  key: 'party',
                  header: isHe ? 'לקוח/ספק' : 'Party',
                  sortable: true,
                  truncate: 'max-w-[200px]',
                  title: r => r.party ?? '',
                  cell: r => <span dir="rtl">{r.party || '-'}</span>,
                  exportValue: r => r.party ?? '',
                },
                {
                  key: 'qty',
                  header: isHe ? 'כמות' : 'Qty',
                  align: 'end',
                  sortable: true,
                  cell: r => formatNumber(r.qty),
                  exportValue: r => r.qty,
                },
                {
                  key: 'total',
                  header: isHe ? 'סה"כ' : 'Total',
                  align: 'end',
                  sortable: true,
                  sortValue: r => r.total ?? 0,
                  cell: r => (r.total ? formatCurrency(r.total) : '-'),
                  exportValue: r => r.total ?? '',
                },
              ] satisfies DataTableColumn<MovementRow>[]}
              // A document can carry the same item on more than one line, so
              // the document number alone is not a unique key.
              getRowKey={(r, i) => `${r.doc_number}-${i}`}
              defaultSort={{ field: 'date', dir: 'desc' }}
              pageSize={25}
              minWidth="min-w-[560px]"
              density="compact"
              exportFileName={isHe ? 'תנועות-פריט' : 'item-movements'}
              mobileCard={{
                title: r => r.party || '-',
                subtitle: r => `${formatErpDate(r.date)} · ${r.doc_number ?? '-'}`,
                accent: r => (r.total ? formatCurrency(r.total) : '-'),
                fields: [{ label: isHe ? 'כמות' : 'Qty', value: r => formatNumber(r.qty) }],
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
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

const VEHICLE_PREVIEW = 5      // vehicles shown before "show all"


/**
 * The scanned vehicles this part appears on, deep-linked into Partly at the
 * exact diagram. Shared by both item states — it used to live inside the
 * catalog-only branch, so a part we actually stock showed no vehicles.
 */
function FitsCard({ fits, isHe, open, setOpen }: {
  fits?: Array<{ label: string; vin?: string; url: string; schema?: string | null }>
  isHe: boolean
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  if (!fits?.length) return null
  const vehiclesOpen = open
  const setVehiclesOpen = setOpen
  return (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4 text-indigo-500" />
              {isHe ? 'מתאים לרכבים' : 'Fits these vehicles'}
              <Badge variant="secondary" className="text-xs">{fits.length}</Badge>
              {fits.length > VEHICLE_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setVehiclesOpen((v) => !v)}
                  aria-expanded={vehiclesOpen}
                  className="ms-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {vehiclesOpen
                    ? (isHe ? 'הסתר' : 'Show less')
                    : (isHe ? 'הצג הכל' : 'Show all')}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${vehiclesOpen ? 'rotate-180' : ''}`} />
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {(vehiclesOpen ? fits : fits.slice(0, VEHICLE_PREVIEW)).map((f: any) => (
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
            {!vehiclesOpen && fits.length > VEHICLE_PREVIEW && (
              <button
                type="button"
                onClick={() => setVehiclesOpen(true)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                {isHe
                  ? `ועוד ${fits.length - VEHICLE_PREVIEW} רכבים`
                  : `+${fits.length - VEHICLE_PREVIEW} more vehicles`}
              </button>
            )}
          </CardContent>
        </Card>
  )
}

/** A part number that is in neither the ERP nor the catalog. */
function UnknownCode({ code, isHe }: { code: string; isHe: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          onClick={() => window.history.back()}
          className="text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label={isHe ? 'חזרה' : 'Back'}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2 min-w-0">
          <Package className="h-5 w-5 text-muted-foreground shrink-0" />
          <span className="font-mono truncate">{code}</span>
        </h1>
      </div>
      <Card>
        <CardContent className="p-6 space-y-4">
          <p className="font-medium">
            {isHe ? 'המק״ט הזה לא קיים אצלנו' : 'We do not have this part number'}
          </p>
          {/* SAY WHAT WAS CHECKED. "Not found" without a bound reads as "we did not look" —
              the reader cannot tell a missing item from a missing search. */}
          <p className="text-sm text-muted-foreground">
            {isHe
              ? 'חיפשנו במלאי, בהיסטוריית הרכש והמכירות ובקטלוג — המספר הזה לא מופיע באף אחד מהם. לרוב זה טעות הקלדה או מק״ט של יצרן אחר.'
              : 'We checked stock, the purchase and sales history, and the catalog — this number appears in none of them. Usually that means a typo, or another manufacturer\'s number.'}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {/* Opens ⌘K rather than linking anywhere: `app/items` has only the `[code]`
                route, so an index link would be a 404 inside a page whose whole job is
                explaining a 404, and /search — the old escape hatch — no longer exists. */}
            <button
              type="button"
              onClick={openCommandPalette}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <Package className="h-4 w-4" />
              {isHe ? 'חיפוש מק״ט' : 'Search part numbers'}
            </button>
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {isHe ? 'חזרה' : 'Go back'}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Everything that is NOT "we do not have it" — a dead session, a dead ERP, a dead network. */
function LoadFailed({ isHe, status }: { isHe: boolean; status?: number }) {
  const expired = status === 401 || status === 403
  return (
    <Card className="mt-4">
      <CardContent className="p-6 space-y-3">
        <p className="font-medium">
          {expired
            ? (isHe ? 'ההתחברות פגה' : 'Your session expired')
            : (isHe ? 'לא הצלחנו לטעון את הפריט' : 'Could not load this item')}
        </p>
        <p className="text-sm text-muted-foreground">
          {expired
            ? (isHe ? 'צריך להתחבר שוב כדי לראות את הפריט.' : 'Sign in again to view this item.')
            : (isHe
              ? 'זו תקלה אצלנו, לא סימן שהפריט לא קיים. אפשר לנסות שוב עוד רגע.'
              : 'This is a fault on our side, not a sign the item is missing. Try again in a moment.')}
          {status ? <span className="ms-2 font-mono text-xs opacity-60">HTTP {status}</span> : null}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted transition-colors"
        >
          {isHe ? 'נסה שוב' : 'Try again'}
        </button>
      </CardContent>
    </Card>
  )
}


export default function ItemDetailPage({ params }: { params: Promise<{ code: string }> }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { code } = use(params)
  const decodedCode = decodeURIComponent(code)
  const { t, locale } = useLocale()
  const { data, isLoading, error } = useItemDetail(decodedCode)
  const { data: linksData } = useItemLinks(decodedCode)
  // Started HERE, not inside PartMediaCard, because everything below the
  // `isLoading` early return is unmounted while the detail query is in flight —
  // so the card's own fetch could not begin until that one had finished, and the
  // page paid for the two in series. Same query key, so the card gets this
  // result rather than issuing a second request.
  useItemMedia(decodedCode)
  const isHe = locale === 'he'
  const [openDocs, setOpenDocs] = useState<DocType | null>(null)
  // 30 vehicles is a lot of card: show a few, let the user open the rest
  const [vehiclesOpen, setVehiclesOpen] = useState(false)
  const toggleDocs = (type: DocType) => setOpenDocs((cur) => (cur === type ? null : type))

  if (isLoading) return <LoadingSkeleton />
  // A CODE WE DO NOT HAVE IS AN ANSWER, NOT A CRASH.
  //
  // This used to render "Error: Failed" — the literal string the fetch hook threw — for every
  // failure alike. Someone holding an invoice with a part number on it got a red line of
  // developer text and no idea whether the number is wrong, the item is discontinued, or the
  // system is down. The page already treats "in the catalog but not the ERP" as a real state
  // worth designing (`catalog_only`, below); this is the same courtesy for a code that is in
  // neither.
  if (error) {
    const status = (error as HttpError).status
    return status === 404
      ? <UnknownCode code={decodedCode} isHe={isHe} />
      : <LoadFailed isHe={isHe} status={status} />
  }
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

        <PartMediaCard code={decodedCode} isHe={isHe} />

        <FitsCard fits={data.fits} isHe={isHe} open={vehiclesOpen} setOpen={setVehiclesOpen} />

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
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(data.stock_qty || 0)}</div>
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
              <div className="text-xl sm:text-2xl font-bold">{data.price ? formatCurrency(data.price) : '-'}</div>
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
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(data.sold_this_year || 0)}</div>
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

      {/* What the part LOOKS like: the photo staff uploaded in the portal and
          the exploded diagram it is called out on. Renders nothing when the
          item has neither. */}
      <PartMediaCard code={decodedCode} isHe={isHe} />

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

      {/* Which scanned vehicles carry this part — same card the catalog-only
          view shows, previously missing here entirely. */}
      <FitsCard fits={data.fits} isHe={isHe} open={vehiclesOpen} setOpen={setVehiclesOpen} />

      {/* What each supplier charges for this part (Xpart price lists) — the buy
          side of the card, next to our own cost and the shelf price above. */}
      <SupplierPricesCard code={decodedCode} isHe={isHe} />

      {/* Every name the part goes by — the single name above is one source's
          wording, chosen by a precedence chain that says nothing about which. */}
      <ItemAliasesCard code={decodedCode} isHe={isHe} />

      {/* Cross-brand equivalent parts (partly.part_links) + manual linking */}
      <PartLinksCard code={decodedCode} links={partLinks} isHe={isHe} />

      {/* Item History Chain — the array runs oldest → newest, and the row lays
          out along the page's reading direction, so in RTL the newest code
          lands leftmost. A hardcoded '→' therefore pointed back at the code
          the part was RE-CODED FROM: on 1920LL it read as if 1675941280 (the
          current id) became 1920LL, exactly backwards. The arrow follows the
          locale, and drifts toward the newest code so the direction is
          readable without decoding the glyph. */}
      {(data.item_id_history?.length > 1 || data.catalog_history?.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Hash className="h-4 w-4 text-amber-500" />
              {isHe ? 'שרשרת קודים' : 'Code History'}
              <span className="text-xs font-normal text-muted-foreground">
                {isHe ? '(ישן ← עדכני)' : '(old → current)'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {data.item_id_history.map((histCode: string, i: number) => {
                const isCurrent = histCode === (data.canonical_code || data.code)
                const Arrow = isHe ? ArrowLeft : ArrowRight
                return (
                  <motion.span
                    key={histCode}
                    className="flex items-center gap-2"
                    initial={{ opacity: 0, x: isHe ? 10 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.12, duration: 0.3, ease: 'easeOut' }}
                  >
                    {i > 0 && (
                      <motion.span
                        className="text-muted-foreground"
                        animate={{ x: isHe ? [0, -3, 0] : [0, 3, 0] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
                      >
                        <Arrow className="h-3.5 w-3.5" />
                      </motion.span>
                    )}
                    <Badge
                      variant={isCurrent ? 'default' : 'outline'}
                      className="font-mono text-xs"
                    >
                      {histCode}
                    </Badge>
                    {isCurrent && (
                      <span className="text-[10px] text-muted-foreground">
                        {isHe ? 'עדכני' : 'current'}
                      </span>
                    )}
                  </motion.span>
                )
              })}

              {/* The manufacturer's catalog carries the chain PAST what Finansit
                  knows: it names the current part number long before we open an
                  item for it. Deliberately marked — a catalog successor is not
                  an ERP-confirmed one, and there may be no code here to price. */}
              {(data.catalog_history ?? []).map((entry: { code: string; name: string | null }, i: number) => {
                const Arrow = isHe ? ArrowLeft : ArrowRight
                const offset = (data.item_id_history?.length ?? 0) + i
                return (
                  <motion.span
                    key={`catalog-${entry.code}`}
                    className="flex items-center gap-2"
                    initial={{ opacity: 0, x: isHe ? 10 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: offset * 0.12, duration: 0.3, ease: 'easeOut' }}
                  >
                    <motion.span
                      className="text-muted-foreground"
                      animate={{ x: isHe ? [0, -3, 0] : [0, 3, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: offset * 0.12 }}
                    >
                      <Arrow className="h-3.5 w-3.5" />
                    </motion.span>
                    <Badge variant="secondary" className="font-mono text-xs border-dashed">
                      <ItemLink code={entry.code} showCode copyable={false} />
                    </Badge>
                    <span
                      className="text-[10px] text-muted-foreground"
                      title={entry.name ?? undefined}
                    >
                      {isHe ? 'מהקטלוג' : 'from catalog'}
                    </span>
                  </motion.span>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
