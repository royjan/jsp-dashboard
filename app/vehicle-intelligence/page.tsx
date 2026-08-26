'use client'

import { Suspense } from 'react'
import { motion } from 'framer-motion'
import { useLocale } from '@/lib/locale-context'
import { useVehiclePopulation } from '@/hooks/use-vehicle-intelligence'
import { PopulationChart } from '@/components/vehicle-intelligence/PopulationChart'
import { MarketTab } from '@/components/vehicle-intelligence/MarketTab'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Car, TrendingUp, BarChart3, Factory } from 'lucide-react'
import { cardVariants } from '@/lib/motion'
import { PageHeader } from '@/components/shared/PageHeader'


function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
      <Skeleton className="h-[400px] w-full" />
    </div>
  )
}

export default function VehicleIntelligencePage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <VehicleIntelligenceContent />
    </Suspense>
  )
}

function VehicleIntelligenceContent() {
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const { data: popData, isLoading: popLoading } = useVehiclePopulation()

  const totalVehicles = popData?.total_vehicles || 0
  // The real distinct-manufacturer count, not the length of the top-20 chart
  // slice — that is what made this card read "20" against 3.78M vehicles.
  const mfrCount = popData?.total_manufacturers ?? popData?.manufacturers?.length ?? 0
  const avgAge = popData?.age_distribution
    ? (() => {
        const total = popData.age_distribution.reduce((s: number, a: any) => s + a.count, 0)
        if (!total) return 0
        const weighted = popData.age_distribution.reduce((s: number, a: any) => {
          const midAge = a.minAge !== undefined ? (a.minAge + Math.min(a.maxAge, 15)) / 2 : 5
          return s + midAge * a.count
        }, 0)
        return (weighted / total).toFixed(1)
      })()
    : '—'

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Car}
        title={isHe ? 'אינטליגנציית רכב' : 'Vehicle Intelligence'}
        description={
          isHe
            ? 'מתאם נתוני רישום רכבים עם היסטוריית מכירות לחיזוי ביקוש'
            : 'Correlating vehicle registration data with sales history to predict demand'
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Car className="h-3 w-3" />
                {isHe ? 'רכבים רשומים' : 'Registered Vehicles'}
              </div>
              <div className="text-2xl font-bold">
                {popLoading ? <Skeleton className="h-8 w-20" /> : totalVehicles.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                {isHe ? 'יצרנים' : 'Manufacturers'}
              </div>
              <div className="text-2xl font-bold">
                {popLoading ? <Skeleton className="h-8 w-16" /> : mfrCount}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {isHe ? 'גיל ממוצע' : 'Avg Age'}
              </div>
              <div className="text-2xl font-bold">
                {popLoading ? <Skeleton className="h-8 w-16" /> : (
                  <>{avgAge} <span className="text-sm font-normal text-muted-foreground">{isHe ? 'שנים' : 'years'}</span></>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

      </div>

      {popData?.warming && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          {isHe
            ? 'מחשב נתוני רישום רכבים (3.8 מיליון רשומות) — הנתונים יופיעו בעוד מספר שניות'
            : 'Computing vehicle registration data (3.8M records) — this will appear in a few seconds'}
        </div>
      )}

      {/* Population overview charts */}
      <motion.div custom={4} variants={cardVariants} initial="hidden" animate="visible">
        <PopulationChart
          manufacturers={popData?.manufacturers || []}
          ageDistribution={popData?.age_distribution || []}
          totalVehicles={totalVehicles}
          isLoading={popLoading}
        />
      </motion.div>


      {/* Vehicle market (Israel registrations) — merged in from the former /market page */}
      <div className="pt-2 border-t">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
          <Factory className="h-5 w-5 text-primary" />
          {isHe ? 'שוק הרכב בישראל' : 'Vehicle Market (Israel)'}
        </h2>
        <MarketTab />
      </div>
    </div>
  )
}
