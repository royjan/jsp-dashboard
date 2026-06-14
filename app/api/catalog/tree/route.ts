import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const categoryId = searchParams.get('categoryId')

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    if (categoryId) {
      // Return subcategories + schema count for a specific category
      const result = await query(
        `SELECT
           sc.id,
           sc.code,
           sc.name,
           COUNT(DISTINCT s.id) as schema_count,
           COUNT(DISTINCT pp.id) as part_count
         FROM partly.subcategories sc
         LEFT JOIN partly.schemas s ON s.subcategory_id = sc.id
         LEFT JOIN partly.project_parts pp ON pp.schema_id = s.id AND pp.deleted_at IS NULL
         WHERE sc.category_id = $1
         GROUP BY sc.id, sc.code, sc.name
         ORDER BY sc.code`,
        [categoryId]
      )

      return NextResponse.json({
        subcategories: result.rows.map((r: any) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          schemaCount: parseInt(r.schema_count || '0'),
          partCount: parseInt(r.part_count || '0'),
        })),
      })
    }

    // Return full category tree with counts
    const result = await query(
      `SELECT
         c.id as category_id,
         c.code as category_code,
         c.name as category_name,
         COUNT(DISTINCT sc.id) as subcategory_count,
         COUNT(DISTINCT s.id) as schema_count,
         COUNT(DISTINCT pp.id) as part_count
       FROM partly.categories c
       LEFT JOIN partly.subcategories sc ON sc.category_id = c.id
       LEFT JOIN partly.schemas s ON s.subcategory_id = sc.id
       LEFT JOIN partly.project_parts pp ON pp.schema_id = s.id AND pp.deleted_at IS NULL
       WHERE c.project_id = $1
       GROUP BY c.id, c.code, c.name
       ORDER BY c.code`,
      [projectId]
    )

    return NextResponse.json({
      categories: result.rows.map((r: any) => ({
        id: r.category_id,
        code: r.category_code,
        name: r.category_name,
        subcategoryCount: parseInt(r.subcategory_count || '0'),
        schemaCount: parseInt(r.schema_count || '0'),
        partCount: parseInt(r.part_count || '0'),
      })),
    })
  } catch (error) {
    console.error('[VIN Catalog] Tree error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch tree' },
      { status: 500 }
    )
  }
}
