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
    const totalVehicles = overview.totalVehicles || 0

    // THE FUEL DONUT HAS TO ADD UP TO THE FLEET, and it did not. The page showed
    // 3,779,276 vehicles in one card and 3,662,154 in the fuel chart, both labelled
    // "רכבים", with nothing saying why they differed. Three separate leaks, measured
    // 2026-08-28:
    //   * 117,122 vehicles carry a BLANK fuelType. ics-stats drops them deliberately
    //     ("missing data, not a fuel") and it is right to — but dropping them silently
    //     turns a subtotal into something that reads as the fleet total.
    //   * `count > 100` here cut every small fuel type with no note anywhere.
    //   * the chart then drew only the top 8 of 9, so its own legend did not sum to
    //     its own centre — off by the 111 in "לא ידוע קוד 0".
    // Now every vehicle lands in exactly one bucket and the buckets sum to
    // totalVehicles, so the two numbers on the page cannot disagree again.

    // "Gasoline" is 340 vehicles of בנזין under an English label — one fuel drawn as
    // two slices. Folded rather than translated at render, so every consumer of this
    // route sees one petrol number.
    const FUEL_ALIASES: Record<string, string> = {
      gasoline: 'בנזין', petrol: 'בנזין', diesel: 'דיזל', electric: 'חשמל',
      hybrid: 'חשמל/בנזין', lpg: 'גפ"מ',
    }
    const merged = new Map<string, number>()
    let classified = 0
    for (const f of (stats.fuelTypes || [])) {
      // `IcsStats.fuelTypes` is typed `{type, count}`; the ?? chain was carried over from
      // when this route also accepted the retired ICS HTTP shape, and it no longer typechecks.
      const raw = String(f.type ?? '').trim()
      if (!raw) continue
      const label = FUEL_ALIASES[raw.toLowerCase()] || raw
      merged.set(label, (merged.get(label) || 0) + (f.count || 0))
      classified += f.count || 0
    }

    const SMALL = 100
    const named = Array.from(merged.entries())
      .map(([fuel, count]) => ({ fuel, name: fuel, count }))
      .sort((a, b) => b.count - a.count)
    // How many REAL fuels there are — the KPI card counts this, not the buckets below,
    // or "אחר" and "ללא סיווג" would inflate it.
    const fuelTypeCount = named.length
    const big = named.filter(f => f.count > SMALL)
    const smallSum = named.filter(f => f.count <= SMALL).reduce((n, f) => n + f.count, 0)

    const fuelTypes = [...big]
    // NAMED, NOT DROPPED. A cap that hides rows reads as "this is everything".
    if (smallSum > 0) fuelTypes.push({ fuel: 'אחר', name: 'אחר', count: smallSum })
    // Everything ics-stats could not classify: blank fuelType, plus the 509 rows whose
    // label is nothing but replacement characters. Stated rather than subtracted away.
    const unclassified = Math.max(0, totalVehicles - classified)
    if (unclassified > 0) {
      fuelTypes.push({ fuel: 'ללא סיווג', name: 'ללא סיווג', count: unclassified })
    }
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
      total_vehicles: totalVehicles,
      total_manufacturers: overview.totalManufacturers || 0,
      total_importers: overview.totalImporters || 0,
      top_manufacturers: topManufacturers,
      top_models: topModels,
      psa_models: psaModels,
      psa_total: psaModels.reduce((sum: number, m: any) => sum + (m.count || 0), 0),
      fuel_breakdown: fuelTypes,
      // Real fuels only — `fuel_breakdown` also carries the אחר / ללא סיווג buckets.
      fuel_type_count: fuelTypeCount,
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
