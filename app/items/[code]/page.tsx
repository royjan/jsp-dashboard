'use client'

import { use } from 'react'
import { motion } from 'framer-motion'
import { useItemDetail } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import {
  ArrowLeft, Package, DollarSign, Warehouse, TrendingUp, Tag, MapPin, Calendar, Layers, Hash,
} from 'lucide-react'
import { ILS_FORMAT, NUMBER_FORMAT } from '@/lib/constants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

function excelDateToString(serial: string | number | undefined): string {
  if (!serial) return '-'
  const n = typeof serial === 'string' ? parseInt(serial, 10) : serial
  if (isNaN(n) || n < 1000) return String(serial)
  const date = new Date((n - 25569) * 86400000)
  return date.toLocaleDateString('he-IL')
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
  const isHe = locale === 'he'

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
            <span className="font-mono">{data.canonical_code || data.code || decodedCode}</span>
          </h1>
          {data.name && (
            <p className="text-muted-foreground text-sm mt-0.5" dir="rtl">{data.name}</p>
          )}
        </div>
      </div>

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
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <TrendingUp className="h-3.5 w-3.5 text-violet-500" />
                {isHe ? 'נמכר השנה' : 'Sold This Year'}
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
              <dd>{excelDateToString(data.sale_date)}</dd>
              <dt className="text-muted-foreground">{isHe ? 'קניה אחרונה' : 'Last Purchase'}</dt>
              <dd>{excelDateToString(data.purchase_date)}</dd>
              <dt className="text-muted-foreground">{isHe ? 'ספירה אחרונה' : 'Last Count'}</dt>
              <dd>{excelDateToString(data.count_date)}</dd>
              {data.inquiry_count > 0 && (
                <>
                  <dt className="text-muted-foreground">{isHe ? 'פניות' : 'Inquiries'}</dt>
                  <dd>{data.inquiry_count}</dd>
                </>
              )}
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
