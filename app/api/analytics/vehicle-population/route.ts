export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

const CACHE_KEY = 'vehicle-population:summary:v1'
const CACHE_TTL = 86400 // 24 hours

interface ManufacturerSummary {
  manufacturer: string
  count: number
  models: { model: string; count: number }[]
}

interface AgeDistribution {
  bracket: string
  bracketHe: string
  minAge: number
  maxAge: number
  count: number
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === '1'

    if (!forceRefresh) {
      const cached = await getCached<any>(CACHE_KEY)
      if (cached) return NextResponse.json(cached)
    }

    const currentYear = new Date().getFullYear()

    // Top 20 manufacturers with vehicle counts
    const mfrResult = await query(`
      SELECT manufacturer, SUM(COALESCE(quantity, 1)) as count
      FROM ics."Vehicles"
      WHERE manufacturer IS NOT NULL AND manufacturer != ''
      GROUP BY manufacturer
      ORDER BY count DESC
      LIMIT 20
    `)

    // For each top manufacturer, get top models
    const manufacturers: ManufacturerSummary[] = []
    for (const row of mfrResult.rows) {
      const modelsResult = await query(`
        SELECT model, SUM(COALESCE(quantity, 1)) as count
        FROM ics."Vehicles"
        WHERE manufacturer = $1 AND model IS NOT NULL AND model != ''
        GROUP BY model
        ORDER BY count DESC
        LIMIT 15
      `, [row.manufacturer])

      manufacturers.push({
        manufacturer: row.manufacturer,
        count: Number(row.count),
        models: modelsResult.rows.map((m: any) => ({
          model: m.model,
          count: Number(m.count),
        })),
      })
    }

    // Age distribution brackets
    const ageBrackets: AgeDistribution[] = [
      { bracket: '0-3 years', bracketHe: '0-3 שנים', minAge: 0, maxAge: 3, count: 0 },
      { bracket: '3-7 years', bracketHe: '3-7 שנים', minAge: 3, maxAge: 7, count: 0 },
      { bracket: '7-12 years', bracketHe: '7-12 שנים', minAge: 7, maxAge: 12, count: 0 },
      { bracket: '12+ years', bracketHe: '12+ שנים', minAge: 12, maxAge: 100, count: 0 },
    ]

    for (const bracket of ageBrackets) {
      const fromYear = currentYear - bracket.maxAge
      const toYear = currentYear - bracket.minAge
      const result = await query(`
        SELECT COALESCE(SUM(COALESCE(quantity, 1)), 0) as count
        FROM ics."Vehicles"
        WHERE EXTRACT(YEAR FROM "registrationDate") > $1
          AND EXTRACT(YEAR FROM "registrationDate") <= $2
      `, [fromYear, toYear])
      bracket.count = Number(result.rows[0]?.count || 0)
    }

    // Total vehicles
    const totalResult = await query(`
      SELECT COALESCE(SUM(COALESCE(quantity, 1)), 0) as total
      FROM ics."Vehicles"
    `)

    // Year distribution for charts (last 20 years)
    const yearDistResult = await query(`
      SELECT EXTRACT(YEAR FROM "registrationDate")::int as year,
             SUM(COALESCE(quantity, 1)) as count
      FROM ics."Vehicles"
      WHERE EXTRACT(YEAR FROM "registrationDate") >= $1
      GROUP BY year
      ORDER BY year DESC
    `, [currentYear - 20])

    const response = {
      total_vehicles: Number(totalResult.rows[0]?.total || 0),
      manufacturers,
      age_distribution: ageBrackets,
      year_distribution: yearDistResult.rows.map((r: any) => ({
        year: Number(r.year),
        count: Number(r.count),
      })),
      cached_at: new Date().toISOString(),
    }

    await setCache(CACHE_KEY, response, CACHE_TTL)

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Vehicle Population] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch vehicle population data' },
      { status: 500 },
    )
  }
}
