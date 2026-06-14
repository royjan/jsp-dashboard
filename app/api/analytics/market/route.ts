export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'

const ICS_API = 'https://pgzwvgwxtw.eu-central-1.awsapprunner.com'

export async function GET() {
  try {
    await initializeSecrets()

    // ICS exposes /api/stats with everything we need
    const res = await fetch(`${ICS_API}/api/stats`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`ICS API error: ${res.status}`)
    const stats = await res.json()

    const overview = stats.overview || {}
    const fuelTypes = (stats.fuelTypes || []).filter((f: any) => f.count > 100)
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
