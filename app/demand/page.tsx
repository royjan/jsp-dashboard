'use client'

import { useState } from 'react'
import { useDemandAnalysis } from '@/hooks/use-analytics'
import { useItems } from '@/hooks/use-dashboard'
import { useLocale } from '@/lib/locale-context'
import { DemandBarChart } from '@/components/charts/DemandBarChart'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ZAxis } from 'recharts'

export default function DemandPage() {
  const { t } = useLocale()
  const [mode, setMode] = useState<'count' | 'qty'>('count')
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]
  const [hoveredCode, setHoveredCode] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(`${currentYear}-01-01`)
  const [dateTo, setDateTo] = useState(today)
  const { data, isLoading } = useDemandAnalysis(dateFrom, dateTo)
  const { data: itemsData } = useItems()

  const demandItems = data?.items || []

  // Build scatter data: merge demand with stock from enriched items
  const enrichedItems = itemsData?.items || []
  const stockMap = new Map(enrichedItems.map((i: any) => [i.code, i]))

  const scatterData = demandItems
    .filter((item: any) => item.code.length > 1)
    .slice(0, 100)
    .map((item: any) => {
      const enriched = stockMap.get(item.code)
      const stockQty = enriched?.stock_qty ?? item.stock_qty ?? 0
      return {
        x: mode === 'count' ? item.request_count : item.total_qty_requested,
        y: stockQty,
        name: item.name,
        code: item.code,
        danger: item.request_count > 1 && stockQty < 5,
      }
    })
    .filter((d: any) => d.x > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'count' | 'qty')}>
          <TabsList>
            <TabsTrigger value="count">{t('byRequests')}</TabsTrigger>
            <TabsTrigger value="qty">{t('byQuantity')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to) }}
        />
      </div>

      <DemandBarChart data={demandItems} isLoading={isLoading} mode={mode} limit={10} hoveredCode={hoveredCode} onHover={setHoveredCode} />

      <Card>
        <CardHeader>
          <CardTitle>{t('demandVsStock')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('highDemandLowStock')}</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="w-full h-[400px]" />
          ) : scatterData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
              No demand data with stock info available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4a5168" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={mode === 'count' ? t('requestCount') : t('qtyRequested')}
                  tick={{ fontSize: 12, fill: '#e2e8f0' }}
                  tickLine={{ stroke: '#4a5168' }}
                  axisLine={{ stroke: '#4a5168' }}
                  label={{ value: mode === 'count' ? t('requestCount') : t('qtyRequested'), position: 'bottom', fontSize: 13, fill: '#e2e8f0', offset: 15 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={t('stockQty')}
                  tick={{ fontSize: 12, fill: '#e2e8f0' }}
                  tickLine={{ stroke: '#4a5168' }}
                  axisLine={{ stroke: '#4a5168' }}
                  label={{ value: t('stockQty'), angle: -90, position: 'insideLeft', fontSize: 13, fill: '#e2e8f0' }}
                />
                <ZAxis range={[60, 300]} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
                  formatter={(value: any, name: string) => [value, name]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload
                    return p ? `${p.name} (${p.code})` : ''
                  }}
                  labelStyle={{ color: 'var(--popover-foreground)', fontWeight: 'bold' }}
                  itemStyle={{ color: 'var(--popover-foreground)' }}
                />
                <Scatter
                  data={scatterData}
                  onMouseLeave={() => setHoveredCode(null)}
                >
                  {scatterData.map((entry: any, index: number) => {
                    const isHighlighted = entry.code === hoveredCode
                    const isDimmed = hoveredCode && !isHighlighted
                    return (
                      <Cell
                        key={index}
                        fill={entry.danger ? '#f87171' : '#60a5fa'}
                        fillOpacity={isDimmed ? 0.45 : isHighlighted ? 1 : 0.8}
                        stroke={isHighlighted ? '#fff' : 'none'}
                        strokeWidth={isHighlighted ? 2 : 0}
                        r={isHighlighted ? 8 : undefined}
                        onMouseEnter={() => setHoveredCode(entry.code)}
                        onMouseLeave={() => setHoveredCode(null)}
                        style={{ cursor: 'pointer' }}
                      />
                    )
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
