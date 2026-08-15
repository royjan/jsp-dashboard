'use client'

import { motion } from 'framer-motion'
import { useMarketAnalytics } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Car, Factory, Fuel, TrendingUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { formatNumber } from '@/lib/format'
import { cardVariants } from '@/lib/motion'


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
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(v)} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatNumber(Number(v))} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} name={isHe ? 'רכבים' : 'Vehicles'} />
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
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={fuelBreakdown.slice(0, 8)}
                    dataKey="count"
                    nameKey="fuel"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ fuel, percent }: any) => `${fuel} ${(percent * 100).toFixed(0)}%`}
                  >
                    {fuelBreakdown.slice(0, 8).map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatNumber(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
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
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-start py-2 px-2">{isHe ? 'מותג' : 'Brand'}</th>
                    <th className="text-start py-2 px-2">{isHe ? 'דגם' : 'Model'}</th>
                    <th className="text-end py-2 px-2">{isHe ? 'רכבים' : 'Vehicles'}</th>
                  </tr>
                </thead>
                <tbody>
                  {psaModels.slice(0, 30).map((m: any, i: number) => (
                    <tr key={i} className="border-b border-muted/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-2">
                        <Badge variant="outline" className="text-xs">{m.brand}</Badge>
                      </td>
                      <td className="py-2 px-2 font-medium">{m.model || m.manufacturer || '-'}</td>
                      <td className="py-2 px-2 text-end font-bold">{formatNumber(m.count || m.quantity || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
