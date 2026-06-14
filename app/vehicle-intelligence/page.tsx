'use client'

import { useState, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useLocale } from '@/lib/locale-context'
import { useVehiclePopulation, useVehicleDemand, useVehicleLifecycle } from '@/hooks/use-vehicle-intelligence'
import { PopulationChart } from '@/components/vehicle-intelligence/PopulationChart'
import { LifecycleHeatmap } from '@/components/vehicle-intelligence/LifecycleHeatmap'
import { OpportunityTable } from '@/components/vehicle-intelligence/OpportunityTable'
import { MakeModelSelector } from '@/components/vehicle-intelligence/MakeModelSelector'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Car, TrendingUp, BarChart3, Target } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
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

  const [selectedMake, setSelectedMake] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedYearRange, setSelectedYearRange] = useState('')

  const { data: popData, isLoading: popLoading } = useVehiclePopulation()
  const { data: demandData, isLoading: demandLoading } = useVehicleDemand(
    selectedMake, selectedModel, selectedYearRange
  )
  const { data: lifecycleData, isLoading: lifecycleLoading } = useVehicleLifecycle()

  const totalVehicles = popData?.total_vehicles || 0
  const mfrCount = popData?.manufacturers?.length || 0
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
  const demandVehicleCount = demandData?.vehicle_count || 0

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Car className="h-6 w-6 text-primary" />
          {isHe ? 'אינטליגנציית רכב' : 'Vehicle Intelligence'}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {isHe
            ? 'מתאם נתוני רישום רכבים עם היסטוריית מכירות לחיזוי ביקוש'
            : 'Correlating vehicle registration data with sales history to predict demand'}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Target className="h-3 w-3" />
                {isHe ? 'רכבי יעד' : 'Target Vehicles'}
              </div>
              <div className="text-2xl font-bold">
                {demandLoading ? <Skeleton className="h-8 w-20" /> : (
                  demandVehicleCount > 0 ? demandVehicleCount.toLocaleString() : '—'
                )}
              </div>
              {selectedMake && (
                <Badge variant="secondary" className="text-[10px] mt-1">{selectedMake}</Badge>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Population overview charts */}
      <motion.div custom={4} variants={cardVariants} initial="hidden" animate="visible">
        <PopulationChart
          manufacturers={popData?.manufacturers || []}
          ageDistribution={popData?.age_distribution || []}
          totalVehicles={totalVehicles}
          isLoading={popLoading}
          onSelectMake={setSelectedMake}
        />
      </motion.div>

      {/* Make/Model Deep Dive */}
      <motion.div custom={5} variants={cardVariants} initial="hidden" animate="visible">
        <MakeModelSelector
          manufacturers={popData?.manufacturers || []}
          selectedMake={selectedMake}
          selectedModel={selectedModel}
          selectedYearRange={selectedYearRange}
          onMakeChange={setSelectedMake}
          onModelChange={setSelectedModel}
          onYearRangeChange={setSelectedYearRange}
          isLoading={popLoading}
        />
      </motion.div>

      {/* Demand predictions / Opportunity table */}
      <motion.div custom={6} variants={cardVariants} initial="hidden" animate="visible">
        <OpportunityTable
          predictions={demandData?.predictions || []}
          vehicleCount={demandData?.vehicle_count || 0}
          isLoading={demandLoading}
          filters={demandData?.filters}
        />
      </motion.div>

      {/* Lifecycle heatmap */}
      <motion.div custom={7} variants={cardVariants} initial="hidden" animate="visible">
        <LifecycleHeatmap
          heatmap={lifecycleData?.heatmap || []}
          peakAnalysis={lifecycleData?.peak_analysis || []}
          isLoading={lifecycleLoading}
        />
      </motion.div>

      {/* Disclaimer */}
      <div className="text-xs text-muted-foreground text-center pb-4">
        {isHe
          ? 'נתונים אלו הם הערכה בלבד, מבוססת על מתאם בין אוכלוסיית הרכבים לדפוסי מכירות היסטוריים. אין להסתמך עליהם כנתונים מדויקים.'
          : 'These figures are estimates only, based on correlation between vehicle population and historical sales patterns. Do not rely on them as exact data.'}
      </div>
    </div>
  )
}
