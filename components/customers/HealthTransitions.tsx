'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useHealthTransitions } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  MessageSquare,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Clock,
  RotateCcw,
} from 'lucide-react'
import { isDeclineHidden } from '@/lib/privacy'
import { useMoneyHidden } from '@/lib/use-money-hidden'

type FilterTab = 'all' | 'deteriorating' | 'improving' | 'unacknowledged'

const BAND_ORDER: Record<string, number> = { green: 3, yellow: 2, red: 1 }
const BAND_LABELS: Record<string, { he: string; en: string; color: string }> = {
  green: { he: 'בריא', en: 'Healthy', color: 'text-emerald-500' },
  yellow: { he: 'מעקב', en: 'Watch', color: 'text-amber-500' },
  red: { he: 'בסיכון', en: 'At Risk', color: 'text-red-500' },
}

function isDeteriorating(from: string, to: string): boolean {
  return (BAND_ORDER[from] ?? 0) > (BAND_ORDER[to] ?? 0)
}

function BandBadge({ band }: { band: string }) {
  const info = BAND_LABELS[band]
  if (!info) return <Badge variant="outline">{band}</Badge>
  const variant =
    band === 'green' ? 'success' : band === 'yellow' ? 'warning' : 'destructive'
  return <Badge variant={variant}>{info.he}</Badge>
}

interface Transition {
  id: string
  customerCode: string
  customerName: string
  fromBand: string
  toBand: string
  transitionDate: string
  score: number | null
  factors: {
    returnRate?: number
    daysSinceLastPurchase?: number | null
    trend?: string
    yoyChangePct?: number | null
  } | null
  acknowledged: boolean
  acknowledgedBy: string | null
  notes: string | null
}

function TransitionCard({ t: transition, onAcknowledge }: { t: Transition; onAcknowledge: (id: string, notes: string) => void }) {
  useMoneyHidden()
  const { t } = useLocale()
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const [acking, setAcking] = useState(false)
  const deteriorating = isDeteriorating(transition.fromBand, transition.toBand)
  const factors = transition.factors

  const handleAck = async () => {
    setAcking(true)
    await onAcknowledge(transition.id, notes)
    setAcking(false)
    setShowNotes(false)
  }

  return (
    <Card
      className={cn(
        'border-s-4 transition-all',
        deteriorating ? 'border-s-red-500' : 'border-s-emerald-500',
        transition.acknowledged && 'opacity-60'
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <Link
              href={`/customers/${transition.customerCode}`}
              className="font-semibold text-primary hover:underline block truncate"
            >
              {transition.customerName}
            </Link>
            <div className="text-xs text-muted-foreground">{transition.customerCode}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <BandBadge band={transition.fromBand} />
            {deteriorating ? (
              <ArrowDownRight className="h-4 w-4 text-red-500" />
            ) : (
              <ArrowUpRight className="h-4 w-4 text-emerald-500" />
            )}
            <BandBadge band={transition.toBand} />
          </div>
        </div>

        {/* Key factors */}
        {factors && (
          <div className="flex flex-wrap gap-2 text-xs">
            {factors.daysSinceLastPurchase != null && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {factors.daysSinceLastPurchase} {t('daysAgo')}
              </span>
            )}
            {factors.returnRate != null && factors.returnRate > 0 && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <RotateCcw className="h-3 w-3" />
                {(factors.returnRate * 100).toFixed(1)}% {t('returnRate')}
              </span>
            )}
            {factors.yoyChangePct != null && !isDeclineHidden(factors.yoyChangePct < 0) && (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  factors.yoyChangePct < 0 ? 'text-red-500' : 'text-emerald-500'
                )}
              >
                {factors.yoyChangePct < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <TrendingUp className="h-3 w-3" />
                )}
                {factors.yoyChangePct > 0 ? '+' : ''}
                {factors.yoyChangePct.toFixed(0)}% {t('yoyChange')}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{transition.transitionDate}</span>
          {transition.score != null && (
            <span className="font-mono">{t('score')}: {transition.score}</span>
          )}
        </div>

        {/* Actions */}
        {!transition.acknowledged ? (
          <div className="space-y-2">
            {showNotes && (
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={t('notePlaceholder')}
                className="w-full text-sm rounded-md border border-input bg-transparent px-3 py-2 shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[60px] resize-none"
                dir="auto"
              />
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleAck}
                disabled={acking}
                className="gap-1.5"
              >
                <Check className="h-3.5 w-3.5" />
                {t('acknowledge')}
              </Button>
              {!showNotes && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowNotes(true)}
                  className="gap-1.5"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t('addNote')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          transition.notes && (
            <div className="text-xs text-muted-foreground bg-muted rounded p-2">
              {transition.notes}
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}

export function HealthTransitions() {
  const { t } = useLocale()
  const [filter, setFilter] = useState<FilterTab>('all')
  const { data, isLoading, error, refetch } = useHealthTransitions(
    filter === 'all' ? undefined : filter
  )
  const queryClient = useQueryClient()

  const handleAcknowledge = async (id: string, notes: string) => {
    try {
      const res = await fetch('/api/analytics/customer-health/transitions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes }),
      })
      if (!res.ok) throw new Error('Failed to acknowledge')
      // Refetch transitions and badge count
      await refetch()
      queryClient.invalidateQueries({ queryKey: ['health-transitions-unack-count'] })
    } catch (err) {
      console.error('Failed to acknowledge transition:', err)
    }
  }

  const transitions = (data?.transitions || []) as Transition[]
  const unackCount = data?.unacknowledgedDeterioratingCount ?? 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {t('recentChanges')}
            {unackCount > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-[10px]">
                {unackCount}
              </Badge>
            )}
          </CardTitle>
          <Tabs value={filter} onValueChange={v => setFilter(v as FilterTab)}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2 h-6">
                {t('all')}
              </TabsTrigger>
              <TabsTrigger value="deteriorating" className="text-xs px-2 h-6 gap-1">
                <ArrowDownRight className="h-3 w-3 text-red-500" />
                {t('deteriorating')}
              </TabsTrigger>
              <TabsTrigger value="improving" className="text-xs px-2 h-6 gap-1">
                <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                {t('improving')}
              </TabsTrigger>
              <TabsTrigger value="unacknowledged" className="text-xs px-2 h-6">
                {t('unacknowledged')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="py-8 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Failed to load transitions</p>
          </div>
        ) : transitions.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Check className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{t('noTransitions')}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {transitions.map(tr => (
              <TransitionCard key={tr.id} t={tr} onAcknowledge={handleAcknowledge} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
