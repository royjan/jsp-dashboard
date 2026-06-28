import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { initializeSecrets } from '@/lib/aws-secrets'

// Normalize a noisy project `make` value to a canonical brand (regions/languages
// collapsed to MG/Peugeot/Citroën/Opel/DS). Used for both the brand column and filter.
const brandCanon = (col: string) => `CASE
  WHEN ${col} ILIKE '%MG%' OR ${col} LIKE '%מ.ג%' OR ${col} LIKE '%מ"ג%' THEN 'MG'
  WHEN ${col} ILIKE '%peugeot%' OR ${col} LIKE '%פיג%' THEN 'Peugeot'
  WHEN ${col} ILIKE '%citroen%' OR ${col} LIKE '%סיטרו%' THEN 'Citroën'
  WHEN ${col} ILIKE '%opel%' OR ${col} LIKE '%אופל%' THEN 'Opel'
  WHEN ${col} ILIKE '%DS%' OR ${col} LIKE '%די אס%' THEN 'DS'
  ELSE NULLIF(TRIM(${col}), '')
END`

export async function GET(req: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(req.url)
    const statusRaw = searchParams.get('status') || 'all' // 'all' | comma list of exact|mg|linked|unmatched
    const brandRaw = searchParams.get('brand') || '' // comma list of canonical brands
    const sort = searchParams.get('sort') || '' // code | brand | status (default: match rank)
    const dir = searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC'
    const search = searchParams.get('search') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'))
    const offset = (page - 1) * limit

    // Match rules. Partly and Finansit (ERP) item ids are otherwise identical;
    // MG-brand parts carry an extra "MG" prefix on the Finansit side only
    // (e.g. partly 11380247 = ERP MG11380247), so that's a real match too.
    const EXACT = `EXISTS (SELECT 1 FROM erp.items e WHERE e.code = gp.item_number)`
    const MG = `EXISTS (SELECT 1 FROM erp.items e WHERE e.code = 'MG' || gp.item_number)`
    const LINKED = `EXISTS (SELECT 1 FROM partly.finansit_links fl WHERE fl.partly_item_number = gp.item_number)`
    const STATUS_EXPR: Record<string, string> = {
      exact: EXACT,
      mg: `NOT ${EXACT} AND ${MG}`,
      linked: `NOT ${EXACT} AND NOT ${MG} AND ${LINKED}`,
      unmatched: `NOT ${EXACT} AND NOT ${MG} AND NOT ${LINKED}`,
    }

    // Build WHERE + its params once; reused by the rows + count queries.
    const params: any[] = []
    const pf = (v: any) => { params.push(v); return `$${params.length}` }
    const where = ['1=1']

    if (search) {
      const sp = pf(`%${search}%`)
      where.push(`(gp.item_number ILIKE ${sp} OR gp.hebrew_description ILIKE ${sp} OR gp.description ILIKE ${sp})`)
    }
    const statuses = statusRaw && statusRaw !== 'all'
      ? statusRaw.split(',').filter((s) => s in STATUS_EXPR)
      : []
    if (statuses.length) {
      where.push('(' + statuses.map((s) => `(${STATUS_EXPR[s]})`).join(' OR ') + ')')
    }
    const brands = brandRaw ? brandRaw.split(',').map((b) => b.trim()).filter(Boolean) : []
    if (brands.length) {
      const bp = pf(brands)
      where.push(`EXISTS (
        SELECT 1 FROM partly.project_parts pp JOIN partly.projects pr ON pr.id = pp.project_id
        WHERE pp.global_part_id = gp.id AND ${brandCanon('pr.make')} = ANY(${bp})
      )`)
    }
    const whereSql = where.join(' AND ')

    const RANK = `CASE WHEN ei.code IS NOT NULL THEN 3 WHEN ei_mg.code IS NOT NULL THEN 2
                       WHEN fl.finansit_code IS NOT NULL THEN 1 ELSE 0 END`
    const orderBy =
      sort === 'code' ? `gp.item_number ${dir}` :
      sort === 'brand' ? `brand ${dir} NULLS LAST, gp.item_number ASC` :
      sort === 'status' ? `${RANK} ${dir}, gp.item_number ASC` :
      `${RANK} DESC, gp.item_number ASC`

    const limitP = pf(limit)
    const offsetP = pf(offset)

    const [rowsResult, countResult, statsResult, brandsResult] = await Promise.all([
      query(`
        SELECT
          gp.item_number,
          gp.description,
          gp.hebrew_description,
          (
            SELECT string_agg(DISTINCT b.canon, ', ' ORDER BY b.canon)
            FROM (
              SELECT ${brandCanon('pr.make')} AS canon
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
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${limitP} OFFSET ${offsetP}
      `, params),

      query(`SELECT COUNT(*)::int AS total FROM partly.global_parts gp WHERE ${whereSql}`,
        params.slice(0, params.length - 2)),

      query(`
        SELECT
          COUNT(*) FILTER (WHERE ${EXACT})::int AS exact,
          COUNT(*) FILTER (WHERE NOT ${EXACT} AND ${MG})::int AS mg,
          COUNT(*) FILTER (WHERE NOT ${EXACT} AND NOT ${MG} AND ${LINKED})::int AS linked,
          COUNT(*) FILTER (WHERE NOT ${EXACT} AND NOT ${MG} AND NOT ${LINKED})::int AS unmatched
        FROM partly.global_parts gp
      `, []),

      query(`SELECT DISTINCT ${brandCanon('make')} AS brand FROM partly.projects
             WHERE make IS NOT NULL AND TRIM(make) <> '' ORDER BY 1`, []),
    ])

    return NextResponse.json({
      items: rowsResult.rows,
      total: (countResult.rows[0] as any)?.total ?? 0,
      page,
      limit,
      stats: statsResult.rows[0] ?? { exact: 0, mg: 0, linked: 0, unmatched: 0 },
      brands: brandsResult.rows.map((r: any) => r.brand).filter(Boolean),
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
