'use client'

import { motion } from 'framer-motion'
import { useMarketAnalytics } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Car, Factory, Fuel, TrendingUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS, BAR_MAX, PIE_PROPS, DonutCenter, ChartLegendChips, ACTIVE_BAR, ActivePieSector } from '@/components/charts/kit'
import { formatNumber } from '@/lib/format'
import { cardVariants } from '@/lib/motion'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'


/** A row of the PSA-model table. The upstream feed is inconsistent about which
 *  of these key pairs it uses, so both are accepted and normalised at render. */
interface PsaModel {
  manufacturer?: string
  brand?: string
  model?: string
  count?: number
  quantity?: number
}

const psaColumns = (isHe: boolean): DataTableColumn<PsaModel>[] => [
  {
    key: 'brand',
    header: isHe ? 'מותג' : 'Brand',
    sortable: true,
    sortValue: m => m.manufacturer || m.brand || '',
    cell: m => <Badge variant="outline" className="text-xs">{m.manufacturer || m.brand || '—'}</Badge>,
    exportValue: m => m.manufacturer || m.brand || '',
  },
  {
    key: 'model',
    header: isHe ? 'דגם' : 'Model',
    sortable: true,
    sortValue: m => m.model || '',
    cell: m => <span className="font-medium">{m.model || '—'}</span>,
    exportValue: m => m.model || '',
  },
  {
    key: 'count',
    header: isHe ? 'רכבים' : 'Vehicles',
    align: 'end',
    sortable: true,
    sortValue: m => m.count || m.quantity || 0,
    cell: m => <span className="font-bold">{formatNumber(m.count || m.quantity || 0)}</span>,
    exportValue: m => m.count || m.quantity || 0,
  },
]

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

function MarketSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-6"><Skeleton className="w-full h-[300px]" /></CardContent></Card>
    </div>
  )
}

/**
 * Vehicle-market intelligence (Israel registrations): top manufacturers, fuel
 * mix, PSA models. Formerly the standalone /market page — now a tab under
 * /vehicle-intelligence.
 */
export function MarketTab() {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const { data, isLoading, error } = useMarketAnalytics()

  if (isLoading) return <MarketSkeleton />
  if (error) return <div className="text-red-500 p-4">{isHe ? 'שגיאה בטעינת נתוני שוק' : 'Error loading market data'}</div>
  if (!data) return null
  // The registration figures come from a ~10s scan of 3.78M rows that runs in
  // the background on a cold cache. That is a wait, not a failure — showing the
  // red error here is what made a warming page look broken.
  if (data.warming) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        {isHe ? 'מחשב נתוני רישום רכבים…' : 'Computing vehicle registration data…'}
      </div>
    )
  }

  const manufacturers = data.top_manufacturers || []
  const psaModels = data.psa_models || []
  const fuelBreakdown = data.fuel_breakdown || []
  const topMfr = manufacturers[0]

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Car className="h-3.5 w-3.5 text-blue-500" />
                {isHe ? 'סה״כ רכבים בישראל' : 'Total Vehicles'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(data.total_vehicles || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Factory className="h-3.5 w-3.5 text-green-500" />
                {isHe ? 'יצרן מוביל' : 'Top Manufacturer'}
              </div>
              <div className="text-lg font-bold">{topMfr?.manufacturer || topMfr?.model || '-'}</div>
              <div className="text-xs text-muted-foreground">{formatNumber(topMfr?.count || topMfr?.quantity || 0)} {isHe ? 'רכבים' : 'vehicles'}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <TrendingUp className="h-3.5 w-3.5 text-violet-500" />
                {isHe ? 'רכבי PSA' : 'PSA Vehicles'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(data.psa_total || 0)}</div>
              <div className="text-xs text-muted-foreground">Peugeot + Citroën + Opel</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Fuel className="h-3.5 w-3.5 text-amber-500" />
                {isHe ? 'סוגי דלק' : 'Fuel Types'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{fuelBreakdown.length}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Top Manufacturers Chart */}
        {manufacturers.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Factory className="h-4 w-4 text-blue-500" />
                {isHe ? 'יצרנים מובילים' : 'Top Manufacturers'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart
                  data={manufacturers.slice(0, 15).map((m: any) => ({
                    name: m.manufacturer || m.model || '?',
                    count: m.count || m.quantity || 0,
                  }))}
                  layout="vertical"
                  margin={{ left: 0, right: 10 }}
                >
                  <ChartGrid vertical horizontal={false} />
                  <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => formatNumber(v)} />
                  <YAxis type="category" dataKey="name" width={96} {...AXIS_PROPS} />
                  <Tooltip formatter={(v) => formatNumber(Number(v))} />
                  <Bar activeBar={ACTIVE_BAR} dataKey="count" fill="#3b82f6" radius={BAR_RADIUS.horizontal} maxBarSize={BAR_MAX} name={isHe ? 'רכבים' : 'Vehicles'} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Fuel Type Pie Chart */}
        {fuelBreakdown.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Fuel className="h-4 w-4 text-amber-500" />
                {isHe ? 'התפלגות סוגי דלק' : 'Fuel Type Distribution'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie activeShape={ActivePieSector}
                      data={fuelBreakdown.slice(0, 8)}
                      dataKey="count"
                      nameKey="fuel"
                      cx="50%"
                      cy="50%"
                      innerRadius={62}
                      outerRadius={100}
                      label={({ percent }: any) => (percent > 0.06 ? `${(percent * 100).toFixed(0)}%` : '')}
                      labelLine={false}
                      {...PIE_PROPS}
                    >
                      {fuelBreakdown.slice(0, 8).map((_: any, i: number) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatNumber(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <DonutCenter
                  value={formatNumber(fuelBreakdown.reduce((sum: number, f: any) => sum + (f.count || 0), 0))}
                  label={isHe ? 'רכבים' : 'vehicles'}
                />
              </div>
              <ChartLegendChips
                className="justify-center"
                items={fuelBreakdown.slice(0, 8).map((f: any, i: number) => ({
                  key: f.fuel ?? String(i),
                  label: f.fuel ?? '—',
                  value: formatNumber(f.count || 0),
                  color: PIE_COLORS[i % PIE_COLORS.length],
                }))}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* PSA Models Table */}
      {psaModels.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4 text-violet-500" />
              {isHe ? 'דגמי PSA בישראל' : 'PSA Models in Israel'}
              <Badge variant="secondary" className="text-xs">{psaModels.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable<PsaModel>
              rows={psaModels}
              columns={psaColumns(isHe)}
              getRowKey={(m, i) => `${m.manufacturer || m.brand || '?'}/${m.model || i}`}
              defaultSort={{ field: 'count', dir: 'desc' }}
              // Was `slice(0, 30)` before the rows ever reached the table, which
              // read as "these are all the PSA models in Israel" on a list that
              // is routinely longer. maxRows keeps the cap but says so, and lets
              // you open the rest.
              maxRows={30}
              maxHeight="400px"
              minWidth="min-w-[420px]"
              exportFileName={isHe ? 'דגמי-PSA' : 'psa-models'}
              mobileCard={{
                title: m => m.model || '—',
                subtitle: m => m.manufacturer || m.brand || '—',
                accent: m => formatNumber(m.count || m.quantity || 0),
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
