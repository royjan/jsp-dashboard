'use client'

import { useState } from 'react'
import { useSeasonalData } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { SeasonalHeatmap } from '@/components/charts/SeasonalHeatmap'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { SEASONAL_CATEGORIES, MONTH_NAMES } from '@/lib/constants'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function SeasonalPage() {
  const { t } = useLocale()
  const { data, isLoading } = useSeasonalData()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const seasonalData = data?.data || []

  const yoyData = selectedCategory
    ? MONTH_NAMES.map((month, i) => {
        const point = seasonalData.find((d: any) => d.category === selectedCategory && d.month === i + 1)
        return { month, sales: point?.avg_sales || 0 }
      })
    : []

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium text-sm mb-2">{t('summerProducts')}</h3>
              <div className="flex flex-wrap gap-1">
                {SEASONAL_CATEGORIES.summer.map(cat => (
                  <Badge
                    key={cat}
                    variant={selectedCategory === cat ? 'default' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-medium text-sm mb-2">{t('winterProducts')}</h3>
              <div className="flex flex-wrap gap-1">
                {SEASONAL_CATEGORIES.winter.map(cat => (
                  <Badge
                    key={cat}
                    variant={selectedCategory === cat ? 'default' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <SeasonalHeatmap data={seasonalData} isLoading={isLoading} />

      {selectedCategory && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedCategory} - {t('monthlyTrend')}</CardTitle>
            <CardDescription>{t('salesIntensity')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="w-full h-[300px]" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={yoyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    name={t('avgSales')}
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
