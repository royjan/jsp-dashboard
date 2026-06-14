'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Clock,
  TrendingDown,
  RotateCcw,
  AlertTriangle,
  Phone,
  History,
  X,
  Lightbulb,
} from 'lucide-react'

interface HealthScore {
  code: string
  name: string
  score: number
  band: 'green' | 'yellow' | 'red'
  factors: {
    returnRate: number
    daysSinceLastPurchase: number | null
    trend: 'up' | 'down' | 'stable'
    yoyChangePct: number | null
  }
  total_revenue: number
  last_purchase: string
}

interface Suggestion {
  type: 'recency' | 'revenue_decline' | 'return_rate' | 'no_purchase'
  icon: typeof Clock
  message: string
  severity: 'high' | 'medium'
}

function generateSuggestions(customer: HealthScore, t: (key: any) => string): Suggestion[] {
  const suggestions: Suggestion[] = []
  const { factors } = customer

  // No purchase date at all
  if (factors.daysSinceLastPurchase === null) {
    suggestions.push({
      type: 'no_purchase',
      icon: AlertTriangle,
      message: t('noRecentPurchase'),
      severity: 'high',
    })
  }
  // Last purchase was a long time ago
  else if (factors.daysSinceLastPurchase > 30) {
    suggestions.push({
      type: 'recency',
      icon: Clock,
      message: t('lastPurchaseDaysAgo').replace('{days}', String(factors.daysSinceLastPurchase)),
      severity: factors.daysSinceLastPurchase > 90 ? 'high' : 'medium',
    })
  }

  // Revenue declining YoY
  if (factors.yoyChangePct !== null && factors.yoyChangePct < -15) {
    suggestions.push({
      type: 'revenue_decline',
      icon: TrendingDown,
      message: t('revenueDownYoy').replace('{pct}', Math.abs(factors.yoyChangePct).toFixed(0)),
      severity: factors.yoyChangePct < -30 ? 'high' : 'medium',
    })
  }

  // High return rate
  if (factors.returnRate > 0.08) {
    suggestions.push({
      type: 'return_rate',
      icon: RotateCcw,
      message: t('highReturnRate').replace('{pct}', (factors.returnRate * 100).toFixed(1)),
      severity: factors.returnRate > 0.15 ? 'high' : 'medium',
    })
  }

  return suggestions
}

function SuggestionCard({
  customer,
  suggestions,
  onDismiss,
}: {
  customer: HealthScore
  suggestions: Suggestion[]
  onDismiss: (code: string) => void
}) {
  const { t } = useLocale()
  const bandVariant =
    customer.band === 'red' ? 'destructive' : 'warning'

  return (
    <Card className="relative">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/customers/${customer.code}`}
                className="font-semibold text-primary hover:underline truncate"
              >
                {customer.name}
              </Link>
              <Badge variant={bandVariant} className="shrink-0">
                {customer.score}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">{customer.code}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => onDismiss(customer.code)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="space-y-2">
          {suggestions.map((s, i) => {
            const Icon = s.icon
            return (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2 text-sm rounded-md p-2',
                  s.severity === 'high'
                    ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                )}
              >
                <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="text-xs leading-relaxed">{s.message}</span>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" asChild>
            <Link href={`/customers/${customer.code}`}>
              <History className="h-3 w-3" />
              {t('viewHistory')}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface WinBackSuggestionsProps {
  scores: HealthScore[]
  maxItems?: number
}

export function WinBackSuggestions({ scores, maxItems = 10 }: WinBackSuggestionsProps) {
  const { t } = useLocale()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // Only show suggestions for yellow/red customers
  const candidates = scores
    .filter(s => (s.band === 'yellow' || s.band === 'red') && !dismissed.has(s.code))
    .map(s => ({
      customer: s,
      suggestions: generateSuggestions(s, t),
    }))
    .filter(c => c.suggestions.length > 0)
    // Sort by severity: red first, then by number of suggestions
    .sort((a, b) => {
      if (a.customer.band !== b.customer.band) {
        return a.customer.band === 'red' ? -1 : 1
      }
      return b.suggestions.length - a.suggestions.length
    })
    .slice(0, maxItems)

  if (candidates.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {t('winBackSuggestions')}
          <Badge variant="outline" className="text-xs font-normal">
            {candidates.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {candidates.map(({ customer, suggestions }) => (
            <SuggestionCard
              key={customer.code}
              customer={customer}
              suggestions={suggestions}
              onDismiss={code => setDismissed(prev => new Set(prev).add(code))}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
