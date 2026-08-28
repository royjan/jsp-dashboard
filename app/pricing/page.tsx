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
import { ItemLink } from '@/components/shared/ItemLink'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import type { TranslationKey } from '@/lib/i18n'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { PageHeader } from '@/components/shared/PageHeader'
import { PricingTabs } from '@/components/shared/PricingTabs'

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
  recommendation: 'raise' | 'hold' | 'lower' | 'investigate' | 'done'
  list_price: number | null
  cost_price: number | null
  last_sold_price: number
  last_sold_year: number
  last_sold_month: number
  recent_net_price: number
  margin_pct: number | null
  headroom_pct: number
}

interface ElasticityReport {
  items: ElasticityRow[]
  year_range: { from: number; to: number }
  generated_at: string
}

type SortField = 'revenue' | 'variance' | 'signal' | 'name'

/** Render a single tier cell with background color reflecting demand intensity */
function TierCell({ tier, maxQty }: { tier: ElasticityTier; maxQty: number }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

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
          {tier.months}mo · {formatCurrency(tier.price_range[0])}-
          {formatCurrency(tier.price_range[1])}
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
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const [data, setData] = useState<ElasticityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const recStyles: Record<ElasticityRow['recommendation'], { label: string; className: string }> = {
    raise: { label: t('raisePrice'), className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
    hold: { label: t('hold'), className: 'bg-muted text-muted-foreground border-border' },
    lower: { label: t('lowerPrice'), className: 'bg-red-500/15 text-red-500 border-red-500/30' },
    investigate: { label: t('investigate'), className: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
    done: { label: t('alreadyPriced'), className: 'bg-sky-500/15 text-sky-500 border-sky-500/30' },
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

  const rows = useMemo(() => data?.items ?? [], [data])

  // The tier bars are scaled against the busiest tier ANYWHERE in the report,
  // not per row — otherwise every row's widest bar looks equally busy.
  const maxQtyGlobal = useMemo(() => {
    let max = 0
    for (const r of rows) for (const t of r.tiers) if (t.avg_qty > max) max = t.avg_qty
    return max
  }, [rows])

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

  const columns: DataTableColumn<ElasticityRow, SortField>[] = [
    {
      key: 'name',
      header: t('item' as TranslationKey),
      sortable: true,
      sortKey: 'name',
      sortValue: r => r.item_name || r.item_code,
      cell: r => (
        <div>
          <div className="max-w-[200px] truncate font-medium">{r.item_name || r.item_code}</div>
          <ItemLink code={r.item_code} showCode className="text-xs" />
        </div>
      ),
      exportValue: r => r.item_name || r.item_code,
    },
    {
      key: 'revenue',
      header: t('revenue'),
      align: 'end',
      sortable: true,
      sortKey: 'revenue',
      sortValue: r => r.total_revenue,
      cell: r => <span className="font-mono">{formatCurrency(r.total_revenue)}</span>,
      exportValue: r => r.total_revenue,
    },
    {
      key: 'list_price',
      header: t('listPriceCol'),
      align: 'end',
      cell: r => <span className="font-mono">{r.list_price != null ? formatCurrency(r.list_price) : '—'}</span>,
      exportValue: r => r.list_price ?? '',
    },
    {
      key: 'cost_price',
      header: t('costCol'),
      align: 'end',
      hideOnMobile: true,
      cell: r => (
        <span className="font-mono text-muted-foreground">
          {r.cost_price != null ? formatCurrency(r.cost_price) : '—'}
        </span>
      ),
      exportValue: r => r.cost_price ?? '',
    },
    {
      key: 'last_sold',
      header: t('lastSoldCol'),
      align: 'end',
      cell: r => (
        <div>
          <div className="font-mono">{formatCurrency(r.last_sold_price)}</div>
          <div className="text-[10px] text-muted-foreground" dir="ltr">
            {String(r.last_sold_month).padStart(2, '0')}/{String(r.last_sold_year).slice(2)}
          </div>
        </div>
      ),
      exportValue: r => r.last_sold_price,
    },
    {
      key: 'margin_pct',
      header: t('marginCol'),
      align: 'end',
      cell: r => <span className="font-mono text-xs">{r.margin_pct != null ? `${r.margin_pct.toFixed(0)}%` : '—'}</span>,
      exportValue: r => r.margin_pct ?? '',
    },
    {
      key: 'variance',
      header: t('priceRange'),
      align: 'end',
      sortable: true,
      sortKey: 'variance',
      sortValue: r => r.price_variance_pct,
      cell: r => <span className="text-xs text-muted-foreground">±{r.price_variance_pct.toFixed(0)}%</span>,
      exportValue: r => r.price_variance_pct,
    },
    // The three price tiers are a fixed low/mid/high triple on every row, so
    // they get three real columns rather than one cell holding a sub-table —
    // that is what lets them sort and land in the export as separate fields.
    ...(['low', 'mid', 'high'] as const).map((label, i) => ({
      key: `tier_${label}`,
      header: t(label === 'low' ? 'lowTier' : label === 'mid' ? 'midTier' : 'highTier'),
      align: 'center' as const,
      hideOnMobile: true,
      cell: (r: ElasticityRow) => {
        const tier = r.tiers[i]
        return tier ? <TierCell tier={tier} maxQty={maxQtyGlobal} /> : <span className="text-muted-foreground">—</span>
      },
      exportValue: (r: ElasticityRow) => r.tiers[i]?.avg_qty ?? '',
    })),
    {
      key: 'signal',
      header: t('signal'),
      align: 'center',
      sortable: true,
      sortKey: 'signal',
      sortValue: r => r.elasticity_signal,
      cell: r => <SignalIcon signal={r.elasticity_signal} />,
      exportValue: r => r.elasticity_signal,
    },
    {
      key: 'recommendation',
      header: t('recommendation'),
      align: 'end',
      sortable: true,
      cell: r => {
        const rec = recStyles[r.recommendation]
        return (
          <div>
            <Badge variant="outline" className={cn('font-medium', rec.className)}>{rec.label}</Badge>
            {r.recommendation === 'raise' && r.headroom_pct >= 1 && (
              <div className="mt-0.5 text-[10px] text-emerald-500" dir="ltr">
                +{r.headroom_pct.toFixed(0)}% {t('headroomTo')}{' '}
                {formatCurrency(r.tiers.find(x => x.label === 'high')?.price_range[1] ?? 0)}
              </div>
            )}
          </div>
        )
      },
      exportValue: r => recStyles[r.recommendation].label,
    },
  ]

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={DollarSign}
        title={t('priceElasticity')}
        description={`${data.year_range.from}–${data.year_range.to} · ${data.items.length} ${t('itemsAnalyzed')}`}
      >
        <p className="max-w-2xl text-xs text-muted-foreground">{t('pricingDesc')}</p>
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs md:text-sm mb-2">
              <TrendingUp className="h-4 w-4 shrink-0" />
      <PricingTabs />
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
            <DataTable<ElasticityRow, SortField>
              rows={rows}
              columns={columns}
              getRowKey={r => r.item_code}
              defaultSort={{ field: 'revenue', dir: 'desc' }}
              pageSize={40}
              minWidth="min-w-[1200px]"
              exportFileName="גמישות-מחיר"
              mobileCard={{
                title: r => r.item_name || r.item_code,
                subtitle: r => r.item_code,
                accent: r => formatCurrency(r.total_revenue),
                fields: [
                  { label: t('recommendation'), value: r => recStyles[r.recommendation].label },
                  { label: t('marginCol'), value: r => (r.margin_pct != null ? `${r.margin_pct.toFixed(0)}%` : '—') },
                ],
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
