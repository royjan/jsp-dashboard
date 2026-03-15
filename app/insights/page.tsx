'use client'

import { useAIInsights } from '@/hooks/use-ai-insights'
import { useLocale } from '@/lib/locale-context'
import { InsightsFeed } from '@/components/ai/InsightsFeed'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Sparkles } from 'lucide-react'

export default function InsightsPage() {
  const { t } = useLocale()
  const { data, isLoading, refreshInsights } = useAIInsights()

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('aiPoweredInsights')}
          </CardTitle>
          <CardDescription>{t('insightsCachedDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <InsightsFeed
            insights={data?.insights || []}
            isLoading={isLoading}
            onRefresh={() => refreshInsights()}
          />
        </CardContent>
      </Card>
    </div>
  )
}
