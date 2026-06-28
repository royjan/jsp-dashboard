import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(req: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'all' // all | exact | linked | unmatched
    const search = searchParams.get('search') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'))
    const offset = (page - 1) * limit

    const searchCondition = search
      ? `AND (gp.item_number ILIKE $1 OR gp.hebrew_description ILIKE $1 OR gp.description ILIKE $1)`
      : ''
    const searchParam = search ? [`%${search}%`] : []

    // Match rules. Partly and Finansit (ERP) item ids are otherwise identical;
    // MG-brand parts carry an extra "MG" prefix on the Finansit side only
    // (e.g. partly 11380247 = ERP MG11380247), so that's a real match too.
    const EXACT = `EXISTS (SELECT 1 FROM erp.items e WHERE e.code = gp.item_number)`
    const MG = `EXISTS (SELECT 1 FROM erp.items e WHERE e.code = 'MG' || gp.item_number)`
    const LINKED = `EXISTS (SELECT 1 FROM partly.finansit_links fl WHERE fl.partly_item_number = gp.item_number)`

    // Determine which partly parts to show based on status filter
    let statusCondition = ''
    if (status === 'exact') {
      statusCondition = `AND ${EXACT}`
    } else if (status === 'mg') {
      statusCondition = `AND NOT ${EXACT} AND ${MG}`
    } else if (status === 'linked') {
      statusCondition = `AND NOT ${EXACT} AND NOT ${MG} AND ${LINKED}`
    } else if (status === 'unmatched') {
      statusCondition = `AND NOT ${EXACT} AND NOT ${MG} AND NOT ${LINKED}`
    }

    const paramOffset = search ? 2 : 1

    const [rowsResult, countResult, statsResult] = await Promise.all([
      query(`
        SELECT
          gp.item_number,
          gp.description,
          gp.hebrew_description,
          (
            -- Canonical brand(s) for the part, normalized from the noisy project
            -- make values (regions/languages collapsed to MG/Peugeot/Citroën/Opel/DS).
            -- Scalar subquery → evaluated only for the page's rows (post-LIMIT).
            SELECT string_agg(DISTINCT b.canon, ', ' ORDER BY b.canon)
            FROM (
              SELECT CASE
                WHEN pr.make ILIKE '%MG%' OR pr.make LIKE '%מ.ג%' OR pr.make LIKE '%מ"ג%' THEN 'MG'
                WHEN pr.make ILIKE '%peugeot%' OR pr.make LIKE '%פיג%' THEN 'Peugeot'
                WHEN pr.make ILIKE '%citroen%' OR pr.make LIKE '%סיטרו%' THEN 'Citroën'
                WHEN pr.make ILIKE '%opel%' OR pr.make LIKE '%אופל%' THEN 'Opel'
                WHEN pr.make ILIKE '%DS%' OR pr.make LIKE '%די אס%' THEN 'DS'
                ELSE NULLIF(TRIM(pr.make), '')
              END AS canon
              FROM partly.project_parts pp
              JOIN partly.projects pr ON pr.id = pp.project_id
              WHERE pp.global_part_id = gp.id
            ) b
            WHERE b.canon IS NOT NULL
          ) AS brand,
          CASE
            WHEN ei.code IS NOT NULL THEN 'exact'
            WHEN ei_mg.code IS NOT NULL THEN 'mg'
            WHEN fl.finansit_code IS NOT NULL THEN 'linked'
            ELSE 'unmatched'
          END AS status,
          COALESCE(ei.code, ei_mg.code, fl.finansit_code) AS finansit_code,
          COALESCE(ei.name, ei_mg.name, ei2.name) AS finansit_name,
          fl.id AS link_id,
          fl.notes
        FROM partly.global_parts gp
        LEFT JOIN erp.items ei ON ei.code = gp.item_number
        LEFT JOIN erp.items ei_mg ON ei_mg.code = 'MG' || gp.item_number
        LEFT JOIN partly.finansit_links fl ON fl.partly_item_number = gp.item_number
        LEFT JOIN erp.items ei2 ON ei2.code = fl.finansit_code
        WHERE 1=1
        ${searchCondition}
        ${statusCondition}
        ORDER BY
          CASE WHEN ei.code IS NOT NULL THEN 3
               WHEN ei_mg.code IS NOT NULL THEN 2
               WHEN fl.finansit_code IS NOT NULL THEN 1
               ELSE 0 END DESC,
          gp.item_number
        LIMIT $${paramOffset} OFFSET $${paramOffset + 1}
      `, [...searchParam, limit, offset]),

      query(`
        SELECT COUNT(*)::int AS total
        FROM partly.global_parts gp
        WHERE 1=1
        ${searchCondition}
        ${statusCondition}
      `, searchParam),

      query(`
        SELECT
          COUNT(*) FILTER (WHERE ${EXACT})::int AS exact,
          COUNT(*) FILTER (WHERE NOT ${EXACT} AND ${MG})::int AS mg,
          COUNT(*) FILTER (WHERE NOT ${EXACT} AND NOT ${MG} AND ${LINKED})::int AS linked,
          COUNT(*) FILTER (WHERE NOT ${EXACT} AND NOT ${MG} AND NOT ${LINKED})::int AS unmatched
        FROM partly.global_parts gp
      `, []),
    ])

    return NextResponse.json({
      items: rowsResult.rows,
      total: (countResult.rows[0] as any)?.total ?? 0,
      page,
      limit,
      stats: statsResult.rows[0] ?? { exact: 0, mg: 0, linked: 0, unmatched: 0 },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await initializeSecrets()
    const { partly_item_number, finansit_code, notes } = await req.json()
    if (!partly_item_number || !finansit_code) {
      return NextResponse.json({ error: 'partly_item_number and finansit_code required' }, { status: 400 })
    }

    const result = await query(`
      INSERT INTO partly.finansit_links (partly_item_number, finansit_code, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (partly_item_number) DO UPDATE
        SET finansit_code = EXCLUDED.finansit_code,
            notes = EXCLUDED.notes,
            updated_at = now()
      RETURNING *
    `, [partly_item_number.trim(), finansit_code.trim().toUpperCase(), notes ?? null])

    return NextResponse.json(result.rows[0])
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
