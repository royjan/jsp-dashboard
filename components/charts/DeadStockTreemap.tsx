'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import type { DeadStockItem } from '@/lib/types'

const COLORS_BY_YEARS: Record<number, string> = {
  1: '#fbbf24',
  2: '#f97316',
  3: '#ef4444',
  4: '#991b1b',
}

interface DeadStockTreemapProps {
  data: DeadStockItem[]
  isLoading?: boolean
  bare?: boolean
}

export function DeadStockTreemap({ data, isLoading, bare }: DeadStockTreemapProps) {
  const { t } = useLocale()

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>{t('deadStockMap')}</CardTitle></CardHeader>
        <CardContent><Skeleton className="w-full h-[400px]" /></CardContent>
      </Card>
    )
  }

  const totalCapital = data.reduce((sum, item) => sum + item.capital_tied, 0)
  const maxCapital = Math.max(...data.map(i => i.capital_tied), 1)
  const items = data.slice(0, 50)

  // Calculate treemap layout using simple squarified algorithm
  function layoutItems(items: DeadStockItem[], width: number, height: number) {
    const total = items.reduce((s, i) => s + i.capital_tied, 0)
    if (total === 0) return []

    const rects: Array<{ item: DeadStockItem; x: number; y: number; w: number; h: number }> = []
    let x = 0, y = 0, remainingW = width, remainingH = height
    let remaining = [...items]
    let isHorizontal = remainingW >= remainingH

    while (remaining.length > 0) {
      // Take items for this row/column
      const take = Math.max(1, Math.min(Math.ceil(Math.sqrt(remaining.length)), remaining.length))
      const batch = remaining.splice(0, take)
      const batchTotal = batch.reduce((s, i) => s + i.capital_tied, 0)
      const fraction = batchTotal / (batchTotal + remaining.reduce((s, i) => s + i.capital_tied, 0))

      if (isHorizontal) {
        const sliceW = remainingW * fraction
        let cy = y
        for (const item of batch) {
          const itemFrac = item.capital_tied / batchTotal
          const itemH = remainingH * itemFrac
          rects.push({ item, x, y: cy, w: sliceW, h: itemH })
          cy += itemH
        }
        x += sliceW
        remainingW -= sliceW
      } else {
        const sliceH = remainingH * fraction
        let cx = x
        for (const item of batch) {
          const itemFrac = item.capital_tied / batchTotal
          const itemW = remainingW * itemFrac
          rects.push({ item, x: cx, y, w: itemW, h: sliceH })
          cx += itemW
        }
        y += sliceH
        remainingH -= sliceH
      }
      isHorizontal = !isHorizontal
    }
    return rects
  }

  const containerWidth = 800
  const containerHeight = 400
  const rects = layoutItems(items, containerWidth, containerHeight)

  const deadLabel = (years: number) => `${years}+ ${Number(years) > 1 ? t('yearsDead') : t('yearDead')}`

  const content = (
    <>
      <svg
          viewBox={`0 0 ${containerWidth} ${containerHeight}`}
          className="w-full h-auto"
          style={{ maxHeight: 400 }}
        >
          {rects.map(({ item, x, y, w, h }, idx) => {
            const color = COLORS_BY_YEARS[Math.min(item.years_dead, 4)]
            const showText = w > 50 && h > 35
            return (
              <g key={`${item.code}-${idx}`}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={2}
                  rx={3}
                >
                  <title>{`${item.name} (${item.code})\n₪${item.capital_tied.toLocaleString()} | ${item.years_dead} ${Number(item.years_dead) > 1 ? t('yearsDead') : t('yearDead')} | ${t('stock')}: ${item.stock_qty}`}</title>
                </rect>
                {showText && (
                  <>
                    <text
                      x={x + 5}
                      y={y + 16}
                      fontSize={11}
                      fill="#fff"
                      fontWeight="bold"
                      clipPath={`inset(0 ${Math.max(0, w - 10)}px 0 0)`}
                    >
                      {item.name.slice(0, Math.floor(w / 7))}
                    </text>
                    <text x={x + 5} y={y + 30} fontSize={10} fill="rgba(255,255,255,0.85)">
                      &#8362;{(item.capital_tied / 1000).toFixed(1)}K
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>

        <div className="flex items-center gap-4 mt-4 text-xs">
          {Object.entries(COLORS_BY_YEARS).map(([years, color]) => (
            <div key={years} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">{deadLabel(Number(years))}</span>
            </div>
          ))}
        </div>
    </>
  )

  if (bare) return content

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('deadStockMap')}</CardTitle>
        <CardDescription>
          {data.length} {t('deadItems')} | {t('totalCapitalTied')}: &#8362;{totalCapital.toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {content}
      </CardContent>
    </Card>
  )
}
