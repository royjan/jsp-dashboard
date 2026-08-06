import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { initializeSecrets } from '@/lib/aws-secrets'

/**
 * GET /api/analytics/catalog-gap
 *   [?projectId=<uuid>] [?brand=PSA|MG|TOYOTA] [?q=<text>]
 *   [?onlyOrphans=0|1 (default 1)] [?limit=50] [?offset=0] [?vehicles=8]
 *
 * "Parts we don't carry": parts scanned off REAL customer vehicles into the
 * manufacturer catalog (partly.global_parts) that have no sellable code in the
 * ERP (erp.items). Ranked by how many distinct vehicles carried them, because
 * that is the stocking signal.
 *
 * The distinction the page is built around:
 *   sellableEquivalent = null  → nothing we sell covers this part. A real gap.
 *   sellableEquivalent = code  → a cross-brand equivalent IS sellable
 *                                (e.g. Toyota SU00100707 is covered by PSA 6924C1),
 *                                so it is a cross-reference, not a gap.
 * `onlyOrphans` (the DEFAULT) keeps only the first kind.
 *
 * PERFORMANCE. The obvious single query — count(*) OVER () plus a per-row
 * vehicle sub-select over ~93k parts / 1.1M project_parts rows — does not
 * finish (>10 min). The shape that answers in ~2s is: page first with a cheap
 * GROUP BY + LIMIT/OFFSET, then decorate ONLY the returned ids. The cost of
 * that is real: there is no exact total, so the client pages with hasMore
 * ("load more"), never "1-50 of N".
 */

/** A part is covered when the ERP sells its code, or its MG-prefixed twin
 *  (partly stores MG parts without the prefix Finansit carries: '10112700' == 'MG10112700'). */
const SELLABLE = (col: string) =>
  `EXISTS (SELECT 1 FROM erp.items e WHERE e.code = ${col} OR e.code = 'MG' || ${col})`

/** A cross-brand link (partly.part_links) to a part the ERP does sell. */
const HAS_SELLABLE_EQUIVALENT = `EXISTS (
  SELECT 1 FROM partly.part_links pl
  JOIN partly.global_parts eq
    ON eq.id = CASE WHEN pl.global_part_id_a = gp.id
                    THEN pl.global_part_id_b ELSE pl.global_part_id_a END
  WHERE pl.status = 'active'
    AND gp.id IN (pl.global_part_id_a, pl.global_part_id_b)
    AND ${SELLABLE('eq.item_number')}
)`

export interface CatalogGapVehicle {
  vin: string
  make: string | null
  model: string | null
  year: string | null
}

export interface CatalogGapPart {
  itemNumber: string
  brand: string
  description: string | null
  hebrewDescription: string | null
  vehicleCount: number
  /** A capped SAMPLE of the vehicles — `vehicleCount` is the real total. */
  vehicles: CatalogGapVehicle[]
  sellableEquivalent: string | null
  equivalentBrand: string | null
}

export interface CatalogGapResponse {
  parts: CatalogGapPart[]
  count: number
  offset: number
  limit: number
  /** No COUNT(*) exists for this query — page with this, not with a total. */
  hasMore: boolean
  onlyOrphans: boolean
  /** Set when the request hit the export cap, so the UI can say so. */
  truncated: boolean
  tookMs: number
}

const MAX_LIMIT = 5000

export async function GET(req: Request) {
  const started = Date.now()
  try {
    await initializeSecrets()
    const sp = new URL(req.url).searchParams

    const projectId = sp.get('projectId')?.trim() || null
    const brandRaw = sp.get('brand')?.trim().toUpperCase() || null
    const brand = brandRaw && ['PSA', 'MG', 'TOYOTA'].includes(brandRaw) ? brandRaw : null
    const q = sp.get('q')?.trim() || null
    // Absent === the actionable view. Only an explicit `onlyOrphans=0` widens it.
    const onlyOrphans = sp.get('onlyOrphans') !== '0'
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50))
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0)
    const vehicleSample = Math.min(20, Math.max(1, parseInt(sp.get('vehicles') || '8', 10) || 8))

    if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) {
      return NextResponse.json({ error: 'projectId must be a uuid' }, { status: 400 })
    }

    // ---- 1. the page: cheap GROUP BY, ordered by the ranking signal ----
    const params: unknown[] = []
    const p = (v: unknown) => { params.push(v); return `$${params.length}` }

    const conds = [`NOT ${SELLABLE('gp.item_number')}`]
    if (onlyOrphans) conds.push(`NOT ${HAS_SELLABLE_EQUIVALENT}`)
    // "Gaps on THIS car" is a membership test, not a restriction on the
    // aggregate. Narrowing the joined rows instead would force
    // count(DISTINCT project_id) to 1 for every row and destroy the ordering —
    // and the whole point is to see that the part on the customer's Astra also
    // sits on 180 other cars.
    if (projectId) {
      conds.push(`EXISTS (SELECT 1 FROM partly.project_parts f
                          WHERE f.global_part_id = gp.id AND f.deleted_at IS NULL
                            AND f.project_id = ${p(projectId)}::uuid)`)
    }
    if (brand) conds.push(`gp.brand = ${p(brand)}`)
    if (q) {
      const like = p(`%${q}%`)
      conds.push(`(gp.item_number ILIKE ${like} OR gp.description ILIKE ${like} OR gp.hebrew_description ILIKE ${like})`)
    }

    const pageRows = await query(`
      SELECT gp.id, gp.item_number, gp.brand, gp.description, gp.hebrew_description,
             count(DISTINCT pp.project_id)::int AS vehicle_count
      FROM partly.global_parts gp
      JOIN partly.project_parts pp ON pp.global_part_id = gp.id AND pp.deleted_at IS NULL
      WHERE ${conds.join(' AND ')}
      GROUP BY gp.id
      ORDER BY vehicle_count DESC, gp.item_number
      LIMIT ${p(limit)} OFFSET ${p(offset)}
    `, params)

    const page = pageRows.rows as Array<{
      id: string; item_number: string; brand: string
      description: string | null; hebrew_description: string | null; vehicle_count: number
    }>
    const ids = page.map(r => r.id)

    // ---- 2. decorate ONLY those ids ----
    // The vehicle sample is capped inside the LATERAL, not in JS: a part on 237
    // vehicles would otherwise ship 237 rows per part across the wire.
    // DISTINCT ON (make, model) picks the newest VIN of each model rather than
    // the newest N VINs overall — "Rifter, 208, 408" answers "which cars need
    // this?", where three 2026 Dispatches just answer it three times.
    const [vehRes, eqRes] = ids.length
      ? await Promise.all([
          // $3 pins the filtered vehicle to the front of its own sample, so a
          // list scoped to one car always shows that car. NULL when unfiltered,
          // hence the COALESCE — a bare `pr.id = NULL` sorts as NULLS FIRST
          // under DESC and would scramble the order.
          query(`
            SELECT k.pid, v.vin, v.make, v.model, v.year
            FROM unnest($1::uuid[]) AS k(pid)
            CROSS JOIN LATERAL (
              SELECT * FROM (
                SELECT DISTINCT ON (pr.make, pr.model)
                       pr.id, pr.vin, pr.make, pr.model, pr.year
                FROM partly.project_parts pp
                JOIN partly.projects pr ON pr.id = pp.project_id
                WHERE pp.global_part_id = k.pid AND pp.deleted_at IS NULL
                ORDER BY pr.make, pr.model,
                         COALESCE(pr.id = $3::uuid, false) DESC,
                         pr.year DESC NULLS LAST, pr.vin
              ) d
              ORDER BY COALESCE(d.id = $3::uuid, false) DESC,
                       d.year DESC NULLS LAST, d.vin
              LIMIT $2
            ) v
          `, [ids, vehicleSample, projectId]),
          // Skipped entirely under onlyOrphans: every row there is an orphan by
          // construction, so this join could only return nothing.
          onlyOrphans
            ? Promise.resolve({ rows: [] as unknown[] })
            : query(`
                SELECT src.id AS pid, eq.item_number, eq.brand
                FROM partly.part_links pl
                JOIN partly.global_parts src ON src.id IN (pl.global_part_id_a, pl.global_part_id_b)
                JOIN partly.global_parts eq
                  ON eq.id = CASE WHEN pl.global_part_id_a = src.id
                                  THEN pl.global_part_id_b ELSE pl.global_part_id_a END
                WHERE src.id = ANY($1::uuid[]) AND pl.status = 'active'
                  AND ${SELLABLE('eq.item_number')}
                ORDER BY eq.item_number
              `, [ids]),
        ])
      : [{ rows: [] }, { rows: [] }]

    const vehiclesByPart = new Map<string, CatalogGapVehicle[]>()
    for (const v of vehRes.rows as Array<{ pid: string } & CatalogGapVehicle>) {
      const list = vehiclesByPart.get(v.pid) ?? []
      list.push({ vin: v.vin, make: v.make, model: v.model, year: v.year })
      vehiclesByPart.set(v.pid, list)
    }

    const equivalentByPart = new Map<string, { code: string; brand: string }>()
    for (const e of eqRes.rows as Array<{ pid: string; item_number: string; brand: string }>) {
      if (!equivalentByPart.has(e.pid)) equivalentByPart.set(e.pid, { code: e.item_number, brand: e.brand })
    }

    const parts: CatalogGapPart[] = page.map(r => {
      const eq = equivalentByPart.get(r.id) ?? null
      return {
        itemNumber: r.item_number,
        brand: r.brand,
        description: r.description || null,
        // The scrapers write '-' for "no Hebrew yet"; that is an absence, not a value.
        hebrewDescription: r.hebrew_description && r.hebrew_description !== '-' ? r.hebrew_description : null,
        vehicleCount: r.vehicle_count,
        vehicles: vehiclesByPart.get(r.id) ?? [],
        sellableEquivalent: eq?.code ?? null,
        equivalentBrand: eq?.brand ?? null,
      }
    })

    const body: CatalogGapResponse = {
      parts,
      count: parts.length,
      offset,
      limit,
      hasMore: page.length === limit,
      onlyOrphans,
      truncated: limit === MAX_LIMIT && page.length === MAX_LIMIT,
      tookMs: Date.now() - started,
    }
    return NextResponse.json(body)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    )
  }
}
