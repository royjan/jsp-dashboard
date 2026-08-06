import { NextResponse } from 'next/server'
import { client } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  try {
    await initializeSecrets()
    const upper = code.toUpperCase()

    // Try direct fetch and history in parallel; if the direct fetch fails (e.g.
    // the code is a historical/superseded alias), fall back to the canonical code.
    const [itemOrNull, history] = await Promise.all([
      client.items.get(upper).catch(() => null),
      client.items.getHistory(upper).catch(() => null),
    ])

    let item = itemOrNull
    if (!item) {
      // Try history chain first
      const canonical = history?.canonical_code
      if (canonical && canonical !== upper) {
        item = await client.items.get(canonical).catch(() => null)
      }
    }
    if (!item) {
      // Try partly.finansit_links mapping (partly code → finansit code)
      const linkResult = await query(
        `SELECT finansit_code FROM partly.finansit_links WHERE partly_item_number = $1 LIMIT 1`,
        [upper]
      ).catch(() => null)
      const linkedCode = (linkResult?.rows[0] as any)?.finansit_code
      if (linkedCode) {
        item = await client.items.get(linkedCode).catch(() => null)
      }
    }
    if (!item && !upper.startsWith('MG')) {
      // MG-brand parts carry an "MG" prefix on the Finansit side only
      // (e.g. partly 10112700 = Finansit MG10112700), so try that as a fallback.
      item = await client.items.get('MG' + upper).catch(() => null)
    }
    // Cross-brand resolution (brand hierarchy: PSA > MG > TOYOTA).
    // A code whose own item isn't in the ERP resolves through
    // partly.part_links to the highest-priority linked brand that is:
    // TOYOTA -> PSA today; MG -> PSA the moment MG<->PSA links exist.
    let brandResolution: {
      requestedCode: string
      requestedBrand: string
      resolvedCode: string
      resolvedBrand: string
      confidence: string
    } | null = null
    let resolvedHistory: Awaited<ReturnType<typeof client.items.getHistory>> | null = null
    if (!item) {
      // Candidate partly item numbers for the requested code (partly stores
      // MG parts WITHOUT the MG prefix).
      const candidates = [upper]
      if (upper.startsWith('MG')) candidates.push(upper.slice(2))
      const flRes = await query(
        `SELECT partly_item_number FROM partly.finansit_links WHERE finansit_code = $1`,
        [upper]
      ).catch(() => null)
      for (const r of (flRes?.rows ?? []) as { partly_item_number: string }[]) {
        if (!candidates.includes(r.partly_item_number)) candidates.push(r.partly_item_number)
      }

      const links = await query(
        `SELECT DISTINCT ON (gp_other.item_number)
                gp_self.brand AS self_brand,
                gp_other.item_number AS other_code, gp_other.brand AS other_brand,
                pl.confidence,
                (pl.base_global_part_id = gp_other.id) AS other_is_base
         FROM partly.global_parts gp_self
         JOIN partly.part_links pl ON gp_self.id IN (pl.global_part_id_a, pl.global_part_id_b)
         JOIN partly.global_parts gp_other
           ON gp_other.id = CASE WHEN gp_self.id = pl.global_part_id_a
                                 THEN pl.global_part_id_b ELSE pl.global_part_id_a END
         WHERE gp_self.item_number = ANY($1) AND pl.status = 'active'
         ORDER BY gp_other.item_number, (pl.confidence = 'high') DESC`,
        [candidates]
      ).catch(() => null)

      // Explicit base wins; then brand hierarchy (PSA > MG > TOYOTA); then confidence.
      const BRAND_RANK: Record<string, number> = { PSA: 0, MG: 1, TOYOTA: 2 }
      const ranked = ((links?.rows ?? []) as {
        self_brand: string; other_code: string; other_brand: string; confidence: string
        other_is_base: boolean
      }[]).sort(
        (a, b) =>
          Number(Boolean(b.other_is_base)) - Number(Boolean(a.other_is_base)) ||
          (BRAND_RANK[a.other_brand] ?? 9) - (BRAND_RANK[b.other_brand] ?? 9) ||
          (a.confidence === 'high' ? 0 : 1) - (b.confidence === 'high' ? 0 : 1)
      )
      for (const row of ranked) {
        // ERP code for the linked part: MG parts carry the MG prefix on the
        // Finansit side; PSA codes are identical on both sides.
        const erpCandidates =
          row.other_brand === 'MG' ? ['MG' + row.other_code, row.other_code] : [row.other_code]
        for (const erpCode of erpCandidates) {
          const resolved = await client.items.get(erpCode).catch(() => null)
          if (resolved) {
            item = resolved
            let finalCode = erpCode
            // Follow the ERP supersession chain: the catalog-linked code may
            // be superseded (e.g. 1306J5 -> 6501634880) — always land on the
            // newest code, exactly like opening the old code directly would.
            resolvedHistory = await client.items.getHistory(erpCode).catch(() => null)
            const canonical = resolvedHistory?.canonical_code
            if (canonical && canonical !== erpCode) {
              const canonicalItem = await client.items.get(canonical).catch(() => null)
              if (canonicalItem) {
                item = canonicalItem
                finalCode = canonical
              }
            }
            brandResolution = {
              requestedCode: upper,
              requestedBrand: row.self_brand,
              resolvedCode: finalCode,
              resolvedBrand: row.other_brand,
              confidence: row.confidence,
            }
            break
          }
        }
        if (item) break
      }
    }
    if (!item) {
      // Not in the ERP — but partly's catalog (the manufacturer's, far larger than our
      // stock) may still know exactly what this part is. Returning what we know beats a
      // 404: the customer sees the description, which vehicles it fits, and above all
      // whether an EQUIVALENT is something we do sell.
      const cat = await query(
        `SELECT gp.id, gp.item_number, gp.brand, gp.description, gp.hebrew_description
         FROM partly.global_parts gp
         WHERE gp.item_number = ANY($1) LIMIT 1`,
        [[upper, upper.replace(/^MG/, ''), 'MG' + upper]]
      ).catch(() => null)
      const c = cat?.rows?.[0] as any
      if (!c) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }
      const eq = await query(
        `SELECT gp_other.item_number, gp_other.brand, gp_other.description,
                gp_other.hebrew_description,
                COALESCE(ei.code, ei_mg.code) AS erp_code
         FROM partly.part_links pl
         JOIN partly.global_parts gp_other
           ON gp_other.id = CASE WHEN pl.global_part_id_a = $1
                                 THEN pl.global_part_id_b ELSE pl.global_part_id_a END
         LEFT JOIN erp.items ei    ON ei.code = gp_other.item_number
         LEFT JOIN erp.items ei_mg ON ei_mg.code = 'MG' || gp_other.item_number
         WHERE $1 IN (pl.global_part_id_a, pl.global_part_id_b) AND pl.status = 'active'
         ORDER BY (COALESCE(ei.code, ei_mg.code) IS NOT NULL) DESC`,
        [c.id]
      ).catch(() => null)
      // Deep-link each vehicle into partly, at the exact diagram the part sits on when
      // we know it — "מתאים ל: <8 names>" as flat text is a dead end; every one of these
      // is a real scanned vehicle the user may want to open.
      const veh = await query(
        `SELECT DISTINCT ON (p.id)
                p.id AS project_id, p.vin, p.make, p.model, p.year,
                c.name AS category, sub.name AS subcategory, s.name AS schema_name
         FROM partly.project_parts pp
         JOIN partly.projects p ON p.id = pp.project_id
         LEFT JOIN partly.schemas s ON s.id = pp.schema_id
         LEFT JOIN partly.subcategories sub ON sub.id = s.subcategory_id
         LEFT JOIN partly.categories c ON c.id = sub.category_id
         WHERE pp.global_part_id = $1 AND pp.deleted_at IS NULL
         ORDER BY p.id, p.year DESC NULLS LAST
         LIMIT 30`,
        [c.id]
      ).catch(() => null)
      // must match slugify in partly's vehicle page (spaces -> _, drop the rest)
      const slug = (t: string) => t.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
      const partlyBase = (process.env.PARTLY_URL || 'http://192.168.0.112:3001').replace(/\/$/, '')
      return NextResponse.json({
        catalog_only: true,
        code: c.item_number,
        name: (c.hebrew_description && c.hebrew_description !== '-') ? c.hebrew_description : c.description,
        description: c.description,
        brand: c.brand,
        equivalents: (eq?.rows ?? []).map((r: any) => ({
          code: r.item_number, brand: r.brand, erpCode: r.erp_code,
          name: (r.hebrew_description && r.hebrew_description !== '-') ? r.hebrew_description : r.description,
        })),
        fits: (veh?.rows ?? []).map((r: any) => ({
          label: [r.make, r.model, r.year].filter(Boolean).join(' '),
          vin: r.vin,
          url: r.category && r.subcategory && r.schema_name
            ? `${partlyBase}/vehicle/${r.project_id}/${encodeURIComponent(slug(r.category))}/${encodeURIComponent(slug(r.subcategory))}/${encodeURIComponent(slug(r.schema_name))}`
            : `${partlyBase}/vehicle/${r.project_id}`,
          schema: r.schema_name || null,
        })),
      })
    }

    // For brand-resolved items the relevant history chain is the RESOLVED
    // part's, not the requested (catalog-only) code's.
    const effectiveHistory = resolvedHistory ?? history
    return NextResponse.json({
      ...item,
      canonical_code: effectiveHistory?.canonical_code || item.code,
      canonical_name: effectiveHistory?.canonical_name || item.name,
      item_id_history: effectiveHistory?.item_id_history || item.item_id_history,
      ...(brandResolution ? { brand_resolution: brandResolution } : {}),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch item' },
      { status: 500 }
    )
  }
}
