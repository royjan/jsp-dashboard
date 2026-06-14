'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { ArrowUpDown, ShoppingCart } from 'lucide-react'

interface Prediction {
  category: string
  total_sales_qty: number
  total_revenue: number
  unique_items: number
  avg_monthly_qty: number
  estimated_monthly_demand: number
  multiplier: number
  confidence: string
}

interface OpportunityTableProps {
  predictions: Prediction[]
  vehicleCount: number
  isLoading?: boolean
  filters?: { make: string; model: string; year_range: string }
}

type SortKey = 'estimated_monthly_demand' | 'total_sales_qty' | 'total_revenue' | 'multiplier'

export function OpportunityTable({ predictions, vehicleCount, isLoading, filters }: OpportunityTableProps) {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [sortKey, setSortKey] = useState<SortKey>('estimated_monthly_demand')
  const [sortDesc, setSortDesc] = useState(true)

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle><Skeleton className="h-5 w-48" /></CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc)
    else { setSortKey(key); setSortDesc(true) }
  }

  const sorted = [...predictions].sort((a, b) => {
    const diff = (a[sortKey] || 0) - (b[sortKey] || 0)
    return sortDesc ? -diff : diff
  })

  const filterLabel = [
    filters?.make,
    filters?.model,
    filters?.year_range ? (isHe ? `גיל ${filters.year_range}` : `Age ${filters.year_range}`) : '',
  ].filter(Boolean).join(' / ')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{isHe ? 'הזדמנויות ביקוש' : 'Demand Opportunities'}</CardTitle>
            <CardDescription>
              {filterLabel ? (
                <span>
                  {isHe ? 'עבור' : 'For'} <strong>{filterLabel}</strong>
                  {' — '}
                  {vehicleCount.toLocaleString()} {isHe ? 'רכבים' : 'vehicles'}
                </span>
              ) : (
                <span>{isHe ? 'בחר יצרן ודגם לקבלת תחזית ביקוש' : 'Select a make/model for demand forecast'}</span>
              )}
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {isHe ? 'הערכה' : 'Estimate'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!predictions.length ? (
          <div className="text-center text-muted-foreground py-8">
            {isHe ? 'אין נתונים להצגה' : 'No data to display'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-start py-2 px-2 font-medium">
                    {isHe ? 'קטגוריה' : 'Category'}
                  </th>
                  <th
                    className="text-start py-2 px-2 font-medium cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('estimated_monthly_demand')}
                  >
                    <span className="flex items-center gap-1">
                      {isHe ? 'ביקוש חודשי משוער' : 'Est. Monthly Demand'}
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th
                    className="text-start py-2 px-2 font-medium cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('total_sales_qty')}
                  >
                    <span className="flex items-center gap-1">
                      {isHe ? 'מכירות היסטוריות' : 'Historical Sales'}
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="text-start py-2 px-2 font-medium">
                    {isHe ? 'פריטים' : 'Items'}
                  </th>
                  <th
                    className="text-start py-2 px-2 font-medium cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('multiplier')}
                  >
                    <span className="flex items-center gap-1">
                      {isHe ? 'מכפיל מחזור חיים' : 'Lifecycle Multiplier'}
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="text-start py-2 px-2 font-medium">
                    {isHe ? 'ביטחון' : 'Confidence'}
                  </th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => (
                  <tr
                    key={p.category}
                    className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="py-2 px-2 font-medium">{p.category}</td>
                    <td className="py-2 px-2">
                      <span className="font-mono font-bold text-primary">
                        {p.estimated_monthly_demand.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground text-xs ms-1">
                        /{isHe ? 'חודש' : 'mo'}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-mono text-muted-foreground">
                      {p.total_sales_qty.toLocaleString()}
                    </td>
                    <td className="py-2 px-2 font-mono text-muted-foreground">
                      {p.unique_items}
                    </td>
                    <td className="py-2 px-2">
                      <Badge
                        variant={p.multiplier >= 1.3 ? 'default' : p.multiplier >= 0.8 ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        x{p.multiplier.toFixed(1)}
                      </Badge>
                    </td>
                    <td className="py-2 px-2">
                      <Badge
                        variant={p.confidence === 'medium' ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {p.confidence === 'medium' ? (isHe ? 'בינוני' : 'Medium') : (isHe ? 'נמוך' : 'Low')}
                      </Badge>
                    </td>
                    <td className="py-2 px-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
                        <a href="/reorder">
                          <ShoppingCart className="h-3 w-3" />
                          {isHe ? 'הזמן' : 'Reorder'}
                        </a>
                      </Button>
                    </td>
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
