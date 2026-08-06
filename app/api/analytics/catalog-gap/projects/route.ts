import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { initializeSecrets } from '@/lib/aws-secrets'

/**
 * GET /api/analytics/catalog-gap/projects
 *
 * The vehicle picker for the catalog-gap page: every scanned vehicle that
 * actually contributed parts, biggest scan first. ~400 rows, so it ships whole
 * and the client filters it locally.
 */

export interface CatalogGapProject {
  id: string
  vin: string
  make: string | null
  model: string | null
  year: string | null
  partCount: number
}

export async function GET() {
  try {
    await initializeSecrets()
    const res = await query(`
      SELECT pr.id, pr.vin, pr.make, pr.model, pr.year,
             count(*)::int AS part_count
      FROM partly.project_parts pp
      JOIN partly.projects pr ON pr.id = pp.project_id
      WHERE pp.deleted_at IS NULL
      GROUP BY pr.id
      ORDER BY part_count DESC
    `)
    const projects: CatalogGapProject[] = (res.rows as Array<{
      id: string; vin: string; make: string | null
      model: string | null; year: string | null; part_count: number
    }>).map(r => ({
      id: r.id,
      vin: r.vin,
      make: r.make,
      model: r.model,
      year: r.year,
      partCount: r.part_count,
    }))
    return NextResponse.json({ projects })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    )
  }
}
