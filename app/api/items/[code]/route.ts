import { NextResponse } from 'next/server'
import { client, fetchItemHistory } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { partlyCandidates, partlyMatchForms, catalogChainAfter, erpCodeViaSupersession } from '@/lib/partly-codes'

/** The shape of FINAPI's item-history response that this route actually reads. */
interface ItemHistory { canonical_code?: string | null; item_id_history?: unknown[] }

/** Must match slugify() in partly's vehicle route so deep links resolve. */
const slug = (t: string) => t.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
// The origin a person actually browses partly on. :3001 is the container port and it
// answers, but the deep links in an answer get copied into chats and tickets, so they
// should be the address staff already have open — https://192.168.0.112/vehicle/… .
// PARTLY_URL still overrides for a different host.
const partlyBase = (process.env.PARTLY_URL || 'https://192.168.0.112').replace(/\/$/, '')

/**
 * The scanned vehicles a part appears on, deep-linked to the exact diagram.
 *
 * Matched over EVERY spelling the part can have in partly (see partlyCandidates:
 * exact, MG-prefix-stripped, manual finansit_links mapping, Jan's trailing-letter
 * stem) and over EVERY code in the ERP supersession chain.
 *
 * Both halves were missing and both failed silently, as an empty card:
 *  · the MG prefix — partly stores `10526735`, the ERP `MG10526735`, so all
 *    9,931 MG item pages showed no vehicles at all while the catalogue held the
 *    fitment (MG10526735 alone fits 8 scanned cars);
 *  · the chain — 284 superseded codes carry their partly row on the OLD number,
 *    so opening the canonical successor found nothing.
 */
async function vehiclesFor(itemCode: string, knownHistory?: ItemHistory | null) {
  // Chain codes come from one FINAPI history call, NOT itemChainCodes() — that
  // reaches getItems(), which builds the 100k-item / 31MB catalog and costs
  // 10-40s on a cold container. It put that cost on the first item page after
  // every deploy, for a card decoration. Checked against the two codes this
  // fan-out was originally added for: history alone returns the full chain for
  // 9819938480 and 1920LL (both -> 1920LL/9819938480/1675941280), which is what
  // their 8 vehicles depend on.
  //
  // The caller has usually already fetched this code's history; reuse it rather
  // than asking FINAPI the same question twice in one request.
  const chainHas = (knownHistory?.item_id_history ?? []).some(
    (c: unknown) => String(c ?? '').toUpperCase() === itemCode.toUpperCase(),
  )
  const history = chainHas ? knownHistory : await fetchItemHistory(itemCode).catch(() => null)
  const chain = [
    ...new Set(
      [itemCode, history?.canonical_code, ...(history?.item_id_history ?? [])]
        .map((c: unknown) => String(c ?? '').trim())
        .filter(Boolean),
    ),
  ]
  const candidates = (
    await Promise.all(chain.map((c) => partlyCandidates(c).catch(() => [c])))
  ).flat()
  const forms = partlyMatchForms(candidates.length > 0 ? candidates : [itemCode])
  if (forms.length === 0) return []

  const res = await query(
    `SELECT DISTINCT ON (p.id)
            p.id AS project_id, p.vin, p.make, p.model, p.year,
            c.name AS category, sub.name AS subcategory, s.name AS schema_name
       FROM partly.global_parts gp
       JOIN partly.project_parts pp ON pp.global_part_id = gp.id AND pp.deleted_at IS NULL
       JOIN partly.projects p ON p.id = pp.project_id
       LEFT JOIN partly.schemas s ON s.id = pp.schema_id
       LEFT JOIN partly.subcategories sub ON sub.id = s.subcategory_id
       LEFT JOIN partly.categories c ON c.id = sub.category_id
      -- BYTE-IDENTICAL to partly.global_parts_item_number_norm_idx. Reword this
      -- expression and the index stops matching: 1,641ms instead of 83ms.
      WHERE upper(regexp_replace(gp.item_number, '[^A-Za-z0-9]', '', 'g')) = ANY($1)
      ORDER BY p.id, p.year DESC NULLS LAST
      LIMIT 30`,
    [forms],
  ).catch(() => null)

  return (res?.rows ?? []).map((r: any) => ({
    label: [r.make, r.model, r.year].filter(Boolean).join(' '),
    vin: r.vin,
    url: r.category && r.subcategory && r.schema_name
      ? `${partlyBase}/vehicle/${r.project_id}/${encodeURIComponent(slug(r.category))}/${encodeURIComponent(slug(r.subcategory))}/${encodeURIComponent(slug(r.schema_name))}`
      : `${partlyBase}/vehicle/${r.project_id}`,
    schema: r.schema_name || null,
  }))
}

/**
 * Where the last ERP-side code in a chain comes from, for labelling.
 *
 * The ERP chain and the manufacturer's catalog disagree about the current part
 * number more often than not: Finansit's chain is maintained from the price
 * lists we buy against, and Lubinski's covers 1608206580 -> 1609697180 while
 * carrying no row at all for the catalog's 1685352580. Naming the two ends
 * separately is the difference between "our list stops here" and "this number
 * is wrong". Falls back to 'erp' rather than claiming a source we cannot see.
 */
async function erpLatestSource(code: string): Promise<'lubinski' | 'erp'> {
  const r = await query(
    `SELECT 1 FROM xpart.lubinski_price_list WHERE item_id = $1 LIMIT 1`,
    [code],
  ).catch(() => null)
  return (r?.rows?.length ?? 0) > 0 ? 'lubinski' : 'erp'
}

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
      // The ERP has never heard of this code, but the manufacturer's catalog
      // says which code it replaced — and we may well stock THAT one. Walk back
      // into the ERP and hand over its chain, so the page shows
      // 1608206680 -> 1609697280 -> 1685352480 instead of a dead end.
      const erpCode = await erpCodeViaSupersession(c.item_number).catch(() => null)
      const erpChain = erpCode
        ? ((await fetchItemHistory(erpCode).catch(() => null))?.item_id_history ?? [erpCode])
            .map((h: unknown) => String(h))
        : []
      const catalogTail = await catalogChainAfter(
        erpChain.length ? erpChain : [c.item_number],
      ).catch(() => [])

      // must match slugify in partly's vehicle page (spaces -> _, drop the rest)
      return NextResponse.json({
        catalog_only: true,
        code: c.item_number,
        erp_code: erpCode,
        // Oldest -> newest, ERP codes first, exactly like the ERP-backed card.
        item_id_history: erpChain.length ? erpChain : undefined,
        catalog_history: catalogTail.map((t) => ({ ...t, source: 'psa_catalog' })),
        erp_latest: erpChain.length ? erpChain[erpChain.length - 1] : null,
        erp_latest_source: erpChain.length
          ? await erpLatestSource(erpChain[erpChain.length - 1]).catch(() => 'erp')
          : null,
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
    /* Stocked parts want this just as much as unstocked ones — it used to be
       computed only on the catalog-only fallback, so an item we sell showed
       no vehicles at all. */
    const fits = await vehiclesFor(item.code, effectiveHistory).catch(() => [])

    /* The catalog fallback above is gated on the item being ABSENT from the ERP,
       which misses the commoner case: the ERP has the part but never got a name
       for it. 1623199180 comes back from FINAPI as {"name":"", price:7986.06} —
       a part we price at ~8k that renders as a blank line. Partly's catalog is
       the manufacturer's and knows it as "ראש צילינדר חדש קומפלט"; Lubinski's
       price list knows it as "ראש מנוע". Prefer either over showing nothing.
       Name-driven, not existence-driven — an ERP name always wins when present. */
    if (!String(item.name ?? '').trim()) {
      /* xpart.lubinski_price_list is a manual upload last refreshed 2026-03-04.
         Its PRICES are stale — 4,034 of the 87,490 codes it shares with the
         live mirror (dashboard.xpart_supplier_prices, is_retail) now disagree,
         median 5% and 799 by more than 10% — and nothing reads them, here or
         anywhere. Only `description` is used, and only as a name fallback.
         Keep it that way: for a current retail price use the mirror. The table
         survives because it is the one place holding Lubinski's OWN wording —
         Xpart collapses every supplier's price-list text into a single
         source='price_list' row, so per-supplier naming exists nowhere else. */
      const fb = await query(
        `SELECT coalesce(nullif(gp.hebrew_description, '-'), '') AS heb,
                gp.description AS eng,
                l.description AS lubinski
           FROM partly.global_parts gp
           LEFT JOIN xpart.lubinski_price_list l ON l.item_id = gp.item_number
          WHERE gp.item_number = $1
          LIMIT 1`,
        [item.code]
      ).catch(() => null)
      const f = fb?.rows?.[0] as any
      if (f) item = { ...item, name: f.heb || f.lubinski || f.eng || item.name }
    }

    // The catalog reaches one step further than Finansit does: it names the
    // current part number long before we open an item for it. Appended AFTER
    // the ERP chain and kept in its OWN field — `item_id_history` is FINAPI's
    // ERP truth, and stock, price and the analytics chain map all fold through
    // it, so a code the ERP has never heard of must not leak into it.
    const erpChain = (
      (effectiveHistory?.item_id_history || item.item_id_history || [item.code]) as unknown[]
    ).map((h) => String(h))
    const catalogTail = await catalogChainAfter(erpChain).catch(() => [])

    return NextResponse.json({
      ...item,
      fits,
      canonical_code: effectiveHistory?.canonical_code || item.code,
      canonical_name: effectiveHistory?.canonical_name || item.name,
      item_id_history: effectiveHistory?.item_id_history || item.item_id_history,
      catalog_history: catalogTail.map((t) => ({ ...t, source: 'psa_catalog' })),
      // The newest number the manufacturer prints, which is NOT necessarily one
      // we can price. Kept apart from canonical_code for that reason.
      catalog_canonical_code: catalogTail.length ? catalogTail[catalogTail.length - 1].code : null,
      // Where our own lineage stops, so the card can say which list ran out
      // rather than leaving the older code looking simply wrong.
      erp_latest: erpChain[erpChain.length - 1] ?? null,
      erp_latest_source: catalogTail.length
        ? await erpLatestSource(erpChain[erpChain.length - 1]).catch(() => 'erp')
        : null,
      ...(brandResolution ? { brand_resolution: brandResolution } : {}),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch item' },
      { status: 500 }
    )
  }
}
