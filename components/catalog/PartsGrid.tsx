'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Package,
  ExternalLink,
  ShoppingCart,
  FileSpreadsheet,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
type SortDir = 'asc' | 'desc'

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

export function PartsGrid({
  projectId,
  categoryId,
  subcategoryId,
  categoryName,
  searchQuery,
  onSearchChange,
}: PartsGridProps) {
  const [sortKey, setSortKey] = useState<SortKey>('itemNumber')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedAndFiltered = useMemo(() => {
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

    // Sort
    parts = [...parts].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'itemNumber':
          cmp = (a.itemNumber || '').localeCompare(b.itemNumber || '')
          break
        case 'description':
          cmp = (a.description || '').localeCompare(b.description || '')
          break
        case 'stockQty':
          cmp = (a.stockQty ?? -1) - (b.stockQty ?? -1)
          break
        case 'price':
          cmp = (a.price ?? 0) - (b.price ?? 0)
          break
        case 'schemaNumber':
          cmp = (a.schemaNumber || '').localeCompare(b.schemaNumber || '')
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return parts
  }, [data?.parts, localFilter, sortKey, sortDir])

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {sortKey === field ? (
        sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )

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
                <Badge variant="secondary" className="text-xs">{data.total}</Badge>
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
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : sortedAndFiltered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            {localFilter ? 'לא נמצאו חלקים עם הסינון הנוכחי' : 'אין חלקים בקטגוריה זו'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className="text-start px-3 py-2 font-medium">
                    <SortHeader label="מק״ט OEM" field="itemNumber" />
                  </th>
                  <th className="text-start px-3 py-2 font-medium">
                    <SortHeader label="תיאור" field="description" />
                  </th>
                  <th className="text-start px-3 py-2 font-medium hidden lg:table-cell">
                    <SortHeader label="סכמה" field="schemaNumber" />
                  </th>
                  <th className="text-start px-3 py-2 font-medium">כמות</th>
                  <th className="text-start px-3 py-2 font-medium">
                    <SortHeader label="מלאי" field="stockQty" />
                  </th>
                  <th className="text-start px-3 py-2 font-medium">
                    <SortHeader label="מחיר" field="price" />
                  </th>
                  <th className="text-start px-3 py-2 font-medium">סטטוס</th>
                  <th className="text-start px-3 py-2 font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {sortedAndFiltered.map((part) => {
                  const statusConfig = STOCK_STATUS_CONFIG[part.stockStatus]
                  return (
                    <tr
                      key={`${part.globalPartId}-${part.schemaNumber}`}
                      className={cn(
                        'border-b hover:bg-accent/50 transition-colors',
                        part.stockStatus === 'in_stock' && 'bg-emerald-500/5',
                        part.stockStatus === 'out_of_stock' && 'bg-red-500/5',
                        part.stockStatus === 'incoming' && 'bg-amber-500/5',
                      )}
                    >
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs" dir="ltr">{part.itemNumber}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="max-w-[250px]">
                          <div className="truncate text-xs">{part.description}</div>
                          {part.hebrewDescription && (
                            <div className="truncate text-xs text-muted-foreground">{part.hebrewDescription}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 hidden lg:table-cell">
                        {part.schemaName && (
                          <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                            {part.schemaNumber} - {part.schemaName}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{part.quantity}</td>
                      <td className="px-3 py-2">
                        {part.stockQty !== null ? (
                          <div className="text-xs">
                            <span className="font-medium">{part.stockQty}</span>
                            {part.incomingQty !== null && part.incomingQty > 0 && (
                              <span className="text-amber-600 dark:text-amber-400 ms-1">
                                (+{part.incomingQty})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {part.price !== null ? (
                          <span className="text-xs font-medium" dir="ltr">
                            {new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(part.price)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={statusConfig.variant}
                          className={cn('text-[10px] px-1.5', statusConfig.className)}
                        >
                          {statusConfig.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {part.stockStatus !== 'unknown' && (
                            <a
                              href={`/items?code=${encodeURIComponent(part.itemNumber)}`}
                              className="p-1 rounded hover:bg-accent transition-colors"
                              title="צפה בלוח בקרה"
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                            </a>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            disabled
                            title="בקרוב"
                          >
                            <ShoppingCart className="h-3 w-3 me-1" />
                            הצעה
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
