'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, Package, ExternalLink, ShoppingCart, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatNumber, formatCurrency } from '@/lib/constants'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

interface CatalogPart {
  globalPartId: string
  itemNumber: string
  description: string
  hebrewDescription: string | null
  schemeNumber: string | null
  quantity: number
  position: string | null
  schemaName: string | null
  schemaNumber: string | null
  subcategoryName: string | null
  categoryName: string | null
  categoryCode: string | null
  stockQty: number | null
  incomingQty: number | null
  orderedQty: number | null
  price: number | null
  stockStatus: 'in_stock' | 'incoming' | 'out_of_stock' | 'unknown'
}

type SortKey = 'itemNumber' | 'description' | 'stockQty' | 'price' | 'schemaNumber'

interface PartsGridProps {
  projectId: string
  categoryId: string | null
  subcategoryId: string | null
  categoryName: string | null
  searchQuery: string
  onSearchChange: (q: string) => void
}

const STOCK_STATUS_CONFIG = {
  in_stock: { label: 'במלאי', variant: 'success' as const, className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  incoming: { label: 'בדרך', variant: 'warning' as const, className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  out_of_stock: { label: 'אזל', variant: 'destructive' as const, className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  unknown: { label: '-', variant: 'secondary' as const, className: '' },
}


const COLUMNS: DataTableColumn<CatalogPart, SortKey>[] = [
  {
    key: 'itemNumber',
    header: 'מק״ט OEM',
    sortable: true,
    sortKey: 'itemNumber',
    cell: p => <span className="font-mono text-xs" dir="ltr">{p.itemNumber}</span>,
    exportValue: p => p.itemNumber,
  },
  {
    key: 'description',
    header: 'תיאור',
    sortable: true,
    sortKey: 'description',
    title: p => [p.description, p.hebrewDescription].filter(Boolean).join(' · '),
    cell: p => (
      <div className="max-w-[250px]">
        <div className="truncate text-xs">{p.description}</div>
        {p.hebrewDescription && (
          <div className="truncate text-xs text-muted-foreground">{p.hebrewDescription}</div>
        )}
      </div>
    ),
    exportValue: p => p.description,
  },
  {
    key: 'schemaNumber',
    header: 'סכמה',
    sortable: true,
    sortKey: 'schemaNumber',
    hideOnMobile: true,
    cell: p =>
      p.schemaName ? (
        <span className="block max-w-[120px] truncate text-xs text-muted-foreground">
          {p.schemaNumber} - {p.schemaName}
        </span>
      ) : null,
    exportValue: p => (p.schemaName ? `${p.schemaNumber} - ${p.schemaName}` : ''),
  },
  {
    key: 'quantity',
    header: 'כמות',
    align: 'end',
    cell: p => <span className="text-xs">{formatNumber(p.quantity)}</span>,
    exportValue: p => p.quantity,
  },
  {
    key: 'stockQty',
    header: 'מלאי',
    align: 'end',
    sortable: true,
    sortKey: 'stockQty',
    // Unknown stock sorts below zero stock rather than above it — "we do not
    // know" is not the same as "we have none", and mixing them hides the
    // genuinely-empty rows this screen is used to find.
    sortValue: p => p.stockQty ?? -1,
    cell: p =>
      p.stockQty !== null ? (
        <div className="text-xs">
          <span className="font-medium">{formatNumber(p.stockQty)}</span>
          {p.incomingQty !== null && p.incomingQty > 0 && (
            <span className="ms-1 text-amber-600 dark:text-amber-400">(+{p.incomingQty})</span>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
    exportValue: p => p.stockQty ?? '',
  },
  {
    key: 'price',
    header: 'מחיר',
    align: 'end',
    sortable: true,
    sortKey: 'price',
    sortValue: p => p.price ?? 0,
    cell: p =>
      p.price !== null ? (
        <span className="text-xs font-medium" dir="ltr">{formatCurrency(p.price, 2)}</span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
    exportValue: p => p.price ?? '',
  },
  {
    key: 'stockStatus',
    header: 'סטטוס',
    cell: p => {
      const c = STOCK_STATUS_CONFIG[p.stockStatus]
      return <Badge variant={c.variant} className={cn('px-1.5 text-[10px]', c.className)}>{c.label}</Badge>
    },
    exportValue: p => STOCK_STATUS_CONFIG[p.stockStatus].label,
  },
  {
    key: 'actions',
    header: 'פעולות',
    cell: p => (
      <div className="flex items-center gap-1">
        {p.stockStatus !== 'unknown' && (
          <a
            href={`/items?code=${encodeURIComponent(p.itemNumber)}`}
            className="rounded p-1 transition-colors hover:bg-accent"
            title="צפה בלוח בקרה"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        )}
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" disabled title="בקרוב">
          <ShoppingCart className="me-1 h-3 w-3" />
          הצעה
        </Button>
      </div>
    ),
    exportValue: null,
  },
]

export function PartsGrid({
  projectId,
  categoryId,
  subcategoryId,
  categoryName,
  searchQuery,
  onSearchChange,
}: PartsGridProps) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const [localFilter, setLocalFilter] = useState('')

  const queryParams = new URLSearchParams({ projectId })
  if (subcategoryId) queryParams.set('subcategoryId', subcategoryId)
  else if (categoryId) queryParams.set('categoryId', categoryId)
  if (searchQuery) queryParams.set('q', searchQuery)

  const hasSelection = !!categoryId || !!subcategoryId || !!searchQuery

  const { data, isLoading } = useQuery<{ parts: CatalogPart[]; total: number }>({
    queryKey: ['catalog-parts', projectId, categoryId, subcategoryId, searchQuery],
    queryFn: async () => {
      const res = await fetch(`/api/catalog/parts?${queryParams}`)
      if (!res.ok) throw new Error('Failed to fetch parts')
      return res.json()
    },
    enabled: hasSelection,
    staleTime: 5 * 60 * 1000,
  })

  const filtered = useMemo(() => {
    let parts = data?.parts || []

    // Local filter
    if (localFilter) {
      const q = localFilter.toLowerCase()
      parts = parts.filter(p =>
        p.itemNumber?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.hebrewDescription?.toLowerCase().includes(q)
      )
    }

    return parts
  }, [data?.parts, localFilter])

  // Stock summary
  const stockSummary = useMemo(() => {
    const parts = data?.parts || []
    return {
      total: parts.length,
      inStock: parts.filter(p => p.stockStatus === 'in_stock').length,
      incoming: parts.filter(p => p.stockStatus === 'incoming').length,
      outOfStock: parts.filter(p => p.stockStatus === 'out_of_stock').length,
    }
  }, [data?.parts])

  if (!hasSelection) {
    return (
      <Card className="min-h-[400px] flex items-center justify-center">
        <div className="text-center">
          <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">בחר קטגוריה מהתפריט לצפייה בחלקים</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              {categoryName || 'חלקים'}
              {data?.total !== undefined && (
                <Badge variant="secondary" className="text-xs">{formatNumber(data.total)}</Badge>
              )}
            </CardTitle>
            {/* Stock summary mini-badges */}
            {data && data.parts.length > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {stockSummary.inStock} במלאי
                </span>
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {stockSummary.incoming} בדרך
                </span>
                <span className="text-xs text-red-600 dark:text-red-400">
                  {stockSummary.outOfStock} אזל
                </span>
              </div>
            )}
          </div>
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={localFilter}
              onChange={(e) => setLocalFilter(e.target.value)}
              placeholder="סנן חלקים..."
              className="h-8 w-48 ps-9 pe-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable<CatalogPart, SortKey>
          rows={filtered}
          columns={COLUMNS}
          // A part can appear under more than one schema, so the part id alone
          // is not unique — two rows sharing a key make one of them disappear.
          getRowKey={p => `${p.globalPartId}-${p.schemaNumber}`}
          loading={isLoading}
          defaultSort={{ field: 'itemNumber', dir: 'asc' }}
          pageSize={50}
          minWidth="min-w-[900px]"
          exportFileName={`חלקים-${categoryName || 'קטלוג'}`}
          rowClassName={p =>
            cn(
              p.stockStatus === 'in_stock' && 'bg-emerald-500/5',
              p.stockStatus === 'out_of_stock' && 'bg-red-500/5',
              p.stockStatus === 'incoming' && 'bg-amber-500/5',
            )
          }
          labels={{
            empty: localFilter ? 'לא נמצאו חלקים עם הסינון הנוכחי' : 'אין חלקים בקטגוריה זו',
          }}
          mobileCard={{
            title: p => p.itemNumber,
            subtitle: p => p.hebrewDescription || p.description,
            accent: p => (p.price !== null ? formatCurrency(p.price, 2) : '—'),
            fields: [
              { label: 'מלאי', value: p => (p.stockQty !== null ? formatNumber(p.stockQty) : '-') },
              { label: 'סטטוס', value: p => STOCK_STATUS_CONFIG[p.stockStatus].label },
            ],
          }}
        />
      </CardContent>
    </Card>
  )
}
