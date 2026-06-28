'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpDown,
  Info,
} from 'lucide-react'
import { ILS_FORMAT, formatNumber } from '@/lib/constants'
import { ItemLink } from '@/components/shared/ItemLink'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import type { TranslationKey } from '@/lib/i18n'

interface ElasticityTier {
  label: 'low' | 'mid' | 'high'
  price_range: [number, number]
  avg_qty: number
  months: number
}

interface ElasticityRow {
  item_code: string
  item_name: string | null
  total_revenue: number
  total_qty: number
  months_sold: number
  price_min: number
  price_max: number
  price_avg: number
  price_variance_pct: number
  tiers: ElasticityTier[]
  elasticity_signal: number
  recommendation: 'raise' | 'hold' | 'lower' | 'investigate'
}

interface ElasticityReport {
  items: ElasticityRow[]
  year_range: { from: number; to: number }
  generated_at: string
}

type SortField = 'revenue' | 'variance' | 'signal' | 'name'

/** Render a single tier cell with background color reflecting demand intensity */
function TierCell({ tier, maxQty }: { tier: ElasticityTier; maxQty: number }) {
  const intensity = maxQty > 0 ? tier.avg_qty / maxQty : 0
  const bgAlpha = Math.max(0.05, Math.min(0.85, intensity))
  return (
    <td className="py-1.5 px-2 text-center relative">
      <div
        className="absolute inset-0 rounded-sm transition-opacity"
        style={{
          backgroundColor: `rgba(91,149,230,${bgAlpha})`,
        }}
      />
      <div className="relative z-10">
        <div className="text-xs font-mono font-semibold tabular-nums">
          {tier.avg_qty > 0 ? formatNumber(tier.avg_qty, 1) : '—'}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {tier.months}mo · ₪{formatNumber(tier.price_range[0])}-
          ₪{formatNumber(tier.price_range[1])}
        </div>
      </div>
    </td>
  )
}

function SignalIcon({ signal }: { signal: number }) {
  if (signal > 0.2) return <TrendingUp className="h-4 w-4 text-emerald-500" />
  if (signal < -0.3) return <TrendingDown className="h-4 w-4 text-red-500" />
  return <Minus className="h-4 w-4 text-muted-foreground" />
}

export default function PricingPage() {
  const { t } = useLocale()
  const [data, setData] = useState<ElasticityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortField>('revenue')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const recStyles: Record<ElasticityRow['recommendation'], { label: string; className: string }> = {
    raise: { label: t('raisePrice'), className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
    hold: { label: t('hold'), className: 'bg-muted text-muted-foreground border-border' },
    lower: { label: t('lowerPrice'), className: 'bg-red-500/15 text-red-500 border-red-500/30' },
    investigate: { label: t('investigate'), className: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  }

  useEffect(() => {
    setLoading(true)
    fetch('/api/analytics/price-elasticity?top_n=80&min_months=6')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const sorted = useMemo(() => {
    if (!data?.items) return []
    const rows = [...data.items]
    rows.sort((a, b) => {
      let cmp = 0
      switch (sort) {
        case 'revenue':
          cmp = a.total_revenue - b.total_revenue
          break
        case 'variance':
          cmp = a.price_variance_pct - b.price_variance_pct
          break
        case 'signal':
          cmp = a.elasticity_signal - b.elasticity_signal
          break
        case 'name':
          cmp = (a.item_name || a.item_code).localeCompare(
            b.item_name || b.item_code,
          )
          break
      }
      return dir === 'desc' ? -cmp : cmp
    })
    return rows
  }, [data, sort, dir])

  const maxQtyGlobal = useMemo(() => {
    if (!sorted) return 0
    let max = 0
    for (const r of sorted) for (const t of r.tiers) if (t.avg_qty > max) max = t.avg_qty
    return max
  }, [sorted])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-60" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          {error || 'No data'}
        </CardContent>
      </Card>
    )
  }

  const counts = {
    raise: data.items.filter(i => i.recommendation === 'raise').length,
    hold: data.items.filter(i => i.recommendation === 'hold').length,
    lower: data.items.filter(i => i.recommendation === 'lower').length,
  }

  const Header = ({
    field,
    children,
    className,
  }: {
    field: SortField
    children: React.ReactNode
    className?: string
  }) => (
    <th
      className={cn(
        'pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap',
        className,
      )}
      onClick={() => {
        if (sort === field) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
        else {
          setSort(field)
          setDir('desc')
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown
          className={cn(
            'h-3 w-3 shrink-0',
            sort === field ? 'text-foreground' : 'text-muted-foreground/50',
          )}
        />
      </span>
    </th>
  )

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">{t('priceElasticity')}</h1>
          <p className="text-sm text-muted-foreground">
            {data.year_range.from}–{data.year_range.to} · {data.items.length}{' '}
            {t('itemsAnalyzed')}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            {t('pricingDesc')}
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
              <TrendingUp className="h-4 w-4 shrink-0" />
              <span>{t('raisePriceCandidates')}</span>
            </div>
            <div className="text-2xl font-bold text-emerald-500">
              {counts.raise}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('demandHeldOrGrew')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
              <Minus className="h-4 w-4 shrink-0" />
              <span>{t('hold')}</span>
            </div>
            <div className="text-2xl font-bold text-muted-foreground">
              {counts.hold}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('moderateSensitivity')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
              <TrendingDown className="h-4 w-4 shrink-0" />
              <span>{t('lowerPrice')}</span>
            </div>
            <div className="text-2xl font-bold text-red-500">
              {counts.lower}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('demandDropsSharply')}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base">{t('demandByPriceTier')}</CardTitle>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-md">
              <Info className="h-3 w-3 shrink-0" />
              <span>{t('tierExplanation')}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b">
                  <Header field="name" className="text-start">
                    {t('item' as TranslationKey)}
                  </Header>
                  <Header field="revenue" className="text-end">
                    {t('revenue')}
                  </Header>
                  <Header field="variance" className="text-end">
                    {t('priceRange')}
                  </Header>
                  <th className="text-center pb-2 font-medium">{t('lowTier')}</th>
                  <th className="text-center pb-2 font-medium">{t('midTier')}</th>
                  <th className="text-center pb-2 font-medium">{t('highTier')}</th>
                  <Header field="signal" className="text-center">
                    {t('signal')}
                  </Header>
                  <th className="text-end pb-2 font-medium">{t('recommendation')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => {
                  const rec = recStyles[row.recommendation]
                  return (
                    <tr
                      key={row.item_code}
                      className="border-b hover:bg-muted/30 transition-colors"
                    >
                      <td className="py-2">
                        <div className="font-medium truncate max-w-[200px]">
                          {row.item_name || row.item_code}
                        </div>
                        <ItemLink code={row.item_code} showCode className="text-xs" />
                      </td>
                      <td className="py-2 text-end font-mono tabular-nums">
                        {ILS_FORMAT.format(row.total_revenue)}
                      </td>
                      <td className="py-2 text-end text-xs text-muted-foreground">
                        ±{row.price_variance_pct.toFixed(0)}%
                      </td>
                      {row.tiers.map(t => (
                        <TierCell
                          key={t.label}
                          tier={t}
                          maxQty={maxQtyGlobal}
                        />
                      ))}
                      <td className="py-2 text-center">
                        <SignalIcon signal={row.elasticity_signal} />
                      </td>
                      <td className="py-2 text-end">
                        <Badge
                          variant="outline"
                          className={cn('font-medium', rec.className)}
                        >
                          {rec.label}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
