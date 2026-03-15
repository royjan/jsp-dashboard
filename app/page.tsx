'use client'

import { useDashboard } from '@/hooks/use-dashboard'
import { useSalesAnalytics, useDemandAnalysis } from '@/hooks/use-analytics'
import { useAIInsights } from '@/hooks/use-ai-insights'
import { useLocale } from '@/lib/locale-context'
import { KPIGrid } from '@/components/dashboard/KPIGrid'
import { SalesAreaChart } from '@/components/charts/SalesAreaChart'
import { DemandBarChart } from '@/components/charts/DemandBarChart'
import { InsightCard } from '@/components/ai/InsightCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles } from 'lucide-react'

export default function HomePage() {
  const { t } = useLocale()
  const { data: dashboard, isLoading: dashLoading } = useDashboard()
  const { data: sales, isLoading: salesLoading } = useSalesAnalytics('30d')
  const { data: demand, isLoading: demandLoading } = useDemandAnalysis()
  const { data: insights, isLoading: insightsLoading } = useAIInsights()

  return (
    <div className="space-y-6">
      <KPIGrid data={dashboard} isLoading={dashLoading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SalesAreaChart
          data={sales?.data || []}
          isLoading={salesLoading}
          title={t('salesTrend')}
        />
        <DemandBarChart
          data={demand?.items || []}
          isLoading={demandLoading}
          mode="count"
          limit={10}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t('aiInsights')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {insightsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(insights?.insights || []).slice(0, 3).map((insight: any, i: number) => (
                <InsightCard key={insight.id || i} insight={insight} index={i} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
