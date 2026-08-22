import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { deriveBrand, BRAND_RANK } from '@/lib/brand'
import { partlyCandidates } from '@/lib/partly-codes'

/**
 * Cross-brand linked parts ("aliases") for an item, from partly.part_links —
 * part equivalences discovered by matching catalog diagram callouts across
 * brands (e.g. Toyota ProAce SU001A0146 <-> PSA 0816K8, same timing belt).
 *
 * GET    — list links. The requested code is a Finansit/dashboard code; the
 *          partly side may store it without the MG prefix, or under a manual
 *          finansit_links mapping — so we fan out to all candidate partly
 *          item_numbers first. Always 200 with { links: [] } on failure —
 *          this feeds a secondary card and must never break the item page.
 * POST   — create a manual link: body { targetCode }. source='manual',
 *          base = higher-hierarchy brand (PSA > MG > TOYOTA); reactivates a
 *          previously rejected pair.
 * DELETE — unlink: body { targetCode }. Manual rows are deleted; automatic
 *          (schema-match) rows are set status='rejected' so the rebuild
 *          script cannot resurrect them.
 */

/** Resolve a code to its partly.global_parts row (first candidate that exists). */
async function resolveGlobalPart(
  upper: string
): Promise<{ id: string; item_number: string; brand: string } | null> {
  const candidates = await partlyCandidates(upper)
  const res = await query(
    `SELECT id, item_number, brand FROM partly.global_parts
     WHERE item_number = ANY($1)
     ORDER BY array_position($1, item_number) LIMIT 1`,
    [candidates]
  ).catch(() => null)
  return (res?.rows?.[0] as { id: string; item_number: string; brand: string }) ?? null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const upper = decodeURIComponent(code || '').trim().toUpperCase()
    if (!upper) return NextResponse.json({ links: [] })

    await initializeSecrets()
    const candidates = await partlyCandidates(upper)

    const { rows } = await query(
      `SELECT DISTINCT ON (gp_other.item_number)
              gp_other.item_number,
              gp_other.brand,
              gp_other.description,
              gp_other.hebrew_description,
              pl.confidence,
              pl.source,
              (pl.base_global_part_id = gp_other.id) AS is_base,
              pl.illustration_number,
              pl.callout,
              COALESCE(ei.code, ei_mg.code) AS erp_code
       FROM partly.part_links pl
       JOIN partly.global_parts gp_self
         ON gp_self.id IN (pl.global_part_id_a, pl.global_part_id_b)
       JOIN partly.global_parts gp_other
         ON gp_other.id = CASE WHEN gp_self.id = pl.global_part_id_a
                               THEN pl.global_part_id_b
                               ELSE pl.global_part_id_a END
       LEFT JOIN erp.items ei    ON ei.code = gp_other.item_number
       LEFT JOIN erp.items ei_mg ON ei_mg.code = 'MG' || gp_other.item_number
       WHERE gp_self.item_number = ANY($1)
         AND gp_other.item_number <> ALL($1)
         AND pl.status = 'active'
       ORDER BY gp_other.item_number`,
      [candidates]
    )

    const links = rows.map((r: any) => ({
      code: r.item_number as string,
      brand: (r.brand as string) || deriveBrand(r.erp_code || r.item_number),
      description: r.description || null,
      // '-' is a common placeholder in partly for "no Hebrew description"
      hebrewDescription: r.hebrew_description && r.hebrew_description !== '-' ? r.hebrew_description : null,
      confidence: r.confidence || 'high',
      source: (r.source as string) || 'schema-match',
      // true = the linked part shown on this row is the BASE (canonical) part
      isBase: Boolean(r.is_base),
      illustrationNumber: r.illustration_number || null,
      callout: r.callout || null,
      // null = the part exists only in the partly catalog, not in the ERP.
      erpCode: (r.erp_code as string | null) || null,
    }))

    // Resolution hierarchy: PSA first, then MG, then TOYOTA; high confidence first.
    links.sort(
      (a, b) =>
        (BRAND_RANK[a.brand] ?? 9) - (BRAND_RANK[b.brand] ?? 9) ||
        (a.confidence === 'high' ? 0 : 1) - (b.confidence === 'high' ? 0 : 1)
    )

    return NextResponse.json({ links })
  } catch (error) {
    console.warn('[items/links] failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ links: [] })
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const upper = decodeURIComponent(code || '').trim().toUpperCase()
    const body = await req.json().catch(() => ({}))
    const targetUpper = String(body?.targetCode || '').trim().toUpperCase()
    if (!upper || !targetUpper) {
      return NextResponse.json({ error: 'targetCode required' }, { status: 400 })
    }

    await initializeSecrets()
    const [self, target] = await Promise.all([
      resolveGlobalPart(upper),
      resolveGlobalPart(targetUpper),
    ])
    if (!self) {
      return NextResponse.json({ error: 'source not in catalog' }, { status: 404 })
    }
    if (!target) {
      return NextResponse.json({ error: 'target not in catalog' }, { status: 404 })
    }
    if (self.id === target.id) {
      return NextResponse.json({ error: 'cannot link a part to itself' }, { status: 400 })
    }

    // Direction-free pair: A = the smaller item number (matches the builder).
    const [a, b] =
      self.item_number < target.item_number ? [self, target] : [target, self]
    // Base = the higher-hierarchy brand side (PSA > MG > TOYOTA).
    const baseId =
      (BRAND_RANK[self.brand] ?? 9) <= (BRAND_RANK[target.brand] ?? 9) ? self.id : target.id
    await query(
      `INSERT INTO partly.part_links (global_part_id_a, global_part_id_b, source, confidence, base_global_part_id, status)
       VALUES ($1, $2, 'manual', 'high', $3, 'active')
       ON CONFLICT ON CONSTRAINT part_links_pair_uq DO UPDATE
         SET status = 'active',
             source = CASE WHEN part_links.status = 'rejected' THEN 'manual' ELSE partly.part_links.source END,
             base_global_part_id = COALESCE(part_links.base_global_part_id, EXCLUDED.base_global_part_id)`,
      [a.id, b.id, baseId]
    )
    return NextResponse.json({ ok: true, linked: { code: target.item_number, brand: target.brand } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const upper = decodeURIComponent(code || '').trim().toUpperCase()
    const body = await req.json().catch(() => ({}))
    const targetUpper = String(body?.targetCode || '').trim().toUpperCase()
    if (!upper || !targetUpper) {
      return NextResponse.json({ error: 'targetCode required' }, { status: 400 })
    }

    await initializeSecrets()
    const [self, target] = await Promise.all([
      resolveGlobalPart(upper),
      resolveGlobalPart(targetUpper),
    ])
    if (!self || !target) {
      return NextResponse.json({ error: 'not in catalog' }, { status: 404 })
    }

    // Manual links are deleted; automatic (schema-match) links are set to
    // status='rejected' so the rebuild script cannot resurrect them.
    const res = await query(
      `WITH target AS (
         SELECT id, source FROM partly.part_links
         WHERE status = 'active'
           AND ((global_part_id_a = $1 AND global_part_id_b = $2)
             OR (global_part_id_a = $2 AND global_part_id_b = $1))
       ),
       deleted AS (
         DELETE FROM partly.part_links WHERE id IN (SELECT id FROM target WHERE source = 'manual')
         RETURNING id, 'deleted'::text AS action
       ),
       rejected AS (
         UPDATE partly.part_links SET status = 'rejected'
         WHERE id IN (SELECT id FROM target WHERE source <> 'manual')
         RETURNING id, 'rejected'::text AS action
       )
       SELECT * FROM deleted UNION ALL SELECT * FROM rejected`,
      [self.id, target.id]
    )
    if (!res.rows.length) {
      return NextResponse.json({ error: 'no active link between these parts' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, action: (res.rows[0] as any).action })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 }
    )
  }
}
