'use client'

import { InsightCard } from './InsightCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { RefreshCw } from 'lucide-react'
import type { AIInsight } from '@/lib/types'

interface InsightsFeedProps {
  insights: AIInsight[]
  isLoading: boolean
  onRefresh?: () => void
}

export function InsightsFeed({ insights, isLoading, onRefresh }: InsightsFeedProps) {
  const { t } = useLocale()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (!insights.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>{t('noInsights')}</p>
        {onRefresh && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 me-1" /> {t('generateInsights')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{insights.length} {t('insights')}</p>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 me-1" /> {t('refresh')}
          </Button>
        )}
      </div>
      {insights.map((insight, i) => (
        <InsightCard key={insight.id} insight={insight} index={i} />
      ))}
    </div>
  )
}
