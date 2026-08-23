export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getIcsStats } from '@/lib/ics-stats'

export async function GET() {
  try {
    await initializeSecrets()

    // Everything this route needs comes out of one cached scan of
    // ics."Vehicles" — the ICS HTTP service this used to call is gone.
    const stats = await getIcsStats()
    // Warming, not broken — see the vehicle-population route.
    if (!stats) {
      return NextResponse.json({
        total_vehicles: 0,
        total_manufacturers: 0,
        total_importers: 0,
        top_manufacturers: [],
        top_models: [],
        psa_models: [],
        psa_total: 0,
        fuel_breakdown: [],
        monthly_trend: [],
        warming: true,
      })
    }

    const overview = stats.overview || {}
    // ICS returns { type: "בנזין", count }. Normalize to `fuel`/`name` so the
    // market pie (nameKey="fuel") and bar (dataKey="name") render real labels
    // instead of "undefined".
    const fuelTypes = (stats.fuelTypes || [])
      .filter((f: any) => f.count > 100)
      .map((f: any) => ({ fuel: f.type ?? f.fuel ?? f.name, name: f.type ?? f.fuel ?? f.name, count: f.count }))
    const topModels = stats.topModels || []
    const monthlyTrend = stats.monthlyTrend || []

    // Find PSA models (Peugeot, Citroen, Opel) from top models
    const psaBrands = ['peugeot', 'citroen', 'citroën', 'opel']
    const psaModels = topModels.filter((m: any) =>
      psaBrands.some(b => (m.manufacturer || '').toLowerCase().includes(b))
    )

    // Top manufacturers — aggregate from topModels
    const mfrMap = new Map<string, number>()
    for (const m of topModels) {
      const mfr = m.manufacturer || 'Unknown'
      mfrMap.set(mfr, (mfrMap.get(mfr) || 0) + (m.count || 0))
    }
    const topManufacturers = Array.from(mfrMap.entries())
      .map(([manufacturer, count]) => ({ manufacturer, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      total_vehicles: overview.totalVehicles || 0,
      total_manufacturers: overview.totalManufacturers || 0,
      total_importers: overview.totalImporters || 0,
      top_manufacturers: topManufacturers,
      top_models: topModels,
      psa_models: psaModels,
      psa_total: psaModels.reduce((sum: number, m: any) => sum + (m.count || 0), 0),
      fuel_breakdown: fuelTypes,
      monthly_trend: monthlyTrend,
    })
  } catch (error) {
    console.error('[Market Analytics] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch market data' },
      { status: 500 },
    )
  }
}
