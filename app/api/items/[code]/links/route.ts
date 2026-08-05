import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { deriveBrand, BRAND_RANK } from '@/lib/brand'

/**
 * Cross-brand linked parts ("aliases") for an item, from partly.part_links —
 * part equivalences discovered by matching catalog diagram callouts across
 * brands (e.g. Toyota ProAce SU001A0146 <-> PSA 0816K8, same timing belt).
 *
 * The requested code is a Finansit/dashboard code; the partly side may store
 * it without the MG prefix, or under a manual finansit_links mapping — so we
 * fan out to all candidate partly item_numbers first.
 *
 * Always returns 200 with { links: [] } on any failure — this feeds a
 * secondary card on the item page and must never break it.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const upper = decodeURIComponent(code || '').trim().toUpperCase()
    if (!upper) return NextResponse.json({ links: [] })

    await initializeSecrets()

    // Candidate partly item numbers for this code.
    const candidates = new Set<string>([upper])
    if (upper.startsWith('MG')) candidates.add(upper.slice(2))
    const manual = await query(
      `SELECT partly_item_number FROM partly.finansit_links WHERE finansit_code = $1`,
      [upper]
    ).catch(() => null)
    for (const row of manual?.rows ?? []) {
      if (row.partly_item_number) candidates.add(String(row.partly_item_number).toUpperCase())
    }

    const { rows } = await query(
      `SELECT DISTINCT ON (gp_other.item_number)
              gp_other.item_number,
              gp_other.brand,
              gp_other.description,
              gp_other.hebrew_description,
              pl.confidence,
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
       ORDER BY gp_other.item_number`,
      [Array.from(candidates)]
    )

    const links = rows.map((r: any) => ({
      code: r.item_number as string,
      brand: (r.brand as string) || deriveBrand(r.erp_code || r.item_number),
      description: r.description || null,
      // '-' is a common placeholder in partly for "no Hebrew description"
      hebrewDescription: r.hebrew_description && r.hebrew_description !== '-' ? r.hebrew_description : null,
      confidence: r.confidence || 'high',
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
