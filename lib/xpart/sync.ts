import type { PoolClient } from 'pg'
import { getPool } from '@/lib/db'
import { xpartQuery, XPART_TENANT_ID } from '@/lib/xpart-db'
import { fetchCatalogCodesAndLinks } from '@/lib/finansit-client'
import { isPlaceholderCode } from '@/lib/services/analytics-service'

/**
 * Mirror Xpart-v2's procurement data into the dashboard.
 *
 * Four things come across, and nothing else:
 *   suppliers   merged onto our own supplier_profiles by ERP code
 *   prices      what each supplier charges, for parts the ERP already knows
 *   chains      supersessions Xpart found that FINAPI's item_id_history lacks
 *   new parts   part numbers our suppliers quote that have no ERP code at all
 *
 * Our own cost and retail are untouched — those still come from FINAPI. The
 * only prices written here are what suppliers charge us.
 *
 * The whole Xpart side is ~1.16M price rows and downloads in under ten seconds,
 * so it is pulled whole and split locally against the ERP catalog rather than
 * round-tripping code lists between two databases that cannot join.
 */

export interface XpartSyncResult {
  syncId: string
  erpCodes: number
  suppliersUpserted: number
  profilesMerged: number
  pricesUpserted: number
  pricesRemoved: number
  chainsSeen: number
  chainsNew: number
  newPartsUpserted: number
  durationMs: number
}

interface PriceRow {
  part_number: string
  supplier_code: string
  supplier_name: string
  supplier_role: string
  price: number
  currency: string
  price_term: string | null
  availability_status: string | null
  lead_time_days: number | null
  minimum_quantity: number | null
  price_list_name: string | null
  effective_date: string | null
  import_markup: number
  fx_to_ils: number
}

/** Insert rows in chunks small enough to stay under Postgres' 65535 parameter cap. */
async function insertChunked(
  client: PoolClient,
  sql: (valuesClause: string) => string,
  rows: unknown[][],
  colsPerRow: number,
): Promise<number> {
  if (rows.length === 0) return 0
  const perChunk = Math.max(1, Math.floor(60000 / colsPerRow))
  let written = 0
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk)
    const params: unknown[] = []
    const values = chunk
      .map((row) => {
        const placeholders = row.map((v) => {
          params.push(v)
          return `$${params.length}`
        })
        return `(${placeholders.join(',')})`
      })
      .join(',')
    const res = await client.query(sql(values), params)
    written += res.rowCount ?? chunk.length
  }
  return written
}

export async function runXpartSync(): Promise<XpartSyncResult> {
  const t0 = Date.now()
  const pool = await getPool()
  const client = await pool.connect()

  const syncRow = await client.query<{ id: string }>(
    `INSERT INTO dashboard.xpart_syncs (status) VALUES ('running') RETURNING id`,
  )
  const syncId = syncRow.rows[0].id

  try {
    // ── The ERP catalog: what counts as a part we already have a code for ──
    const { codes: erpCodes, links: erpLinks } = await fetchCatalogCodesAndLinks()
    if (erpCodes.size < 10_000) {
      // A truncated stream would make the entire catalog look "new" and would
      // wipe every mirrored price as unmatched. Refuse rather than corrupt.
      throw new Error(`ERP catalog stream returned only ${erpCodes.size} codes — refusing to sync`)
    }

    const suppliersUpserted = await syncSuppliers(client)
    const profilesMerged = await mergeSupplierProfiles(client)
    const priceResult = await syncPrices(client, syncId, erpCodes)
    const chainResult = await syncChains(client, erpCodes, erpLinks)
    const newPartsUpserted = await syncNewParts(client, erpCodes, priceResult.unknownParts)

    await client.query(
      `UPDATE dashboard.xpart_syncs
          SET status = 'completed', finished_at = now(), erp_codes = $2,
              suppliers_upserted = $3, prices_upserted = $4, prices_removed = $5,
              chains_new = $6, new_parts_upserted = $7
        WHERE id = $1`,
      [syncId, erpCodes.size, suppliersUpserted, priceResult.upserted, priceResult.removed,
       chainResult.added, newPartsUpserted],
    )

    return {
      syncId,
      erpCodes: erpCodes.size,
      suppliersUpserted,
      profilesMerged,
      pricesUpserted: priceResult.upserted,
      pricesRemoved: priceResult.removed,
      chainsSeen: chainResult.seen,
      chainsNew: chainResult.added,
      newPartsUpserted,
      durationMs: Date.now() - t0,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await client.query(
      `UPDATE dashboard.xpart_syncs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
      [syncId, message],
    )
    throw e
  } finally {
    client.release()
  }
}

// ── Suppliers ──────────────────────────────────────────────────────────────

async function syncSuppliers(client: PoolClient): Promise<number> {
  const suppliers = await xpartQuery<{
    supplier_id: string
    code: string
    name: string
    supplier_role: string | null
    currency: string | null
    default_price_term: string | null
    payment_terms: string | null
    lead_time_days: number | null
    finansit_code: string | null
    finansit_default_price_code: string | null
    is_active: boolean
  }>(
    `SELECT supplier_id, code, name, supplier_role, currency, default_price_term,
            payment_terms, lead_time_days, finansit_code, finansit_default_price_code, is_active
       FROM suppliers WHERE tenant_id = $1`,
    [XPART_TENANT_ID],
  )

  const rows = suppliers.map((s) => [
    s.supplier_id, s.code.trim(), s.name.trim(), s.supplier_role, s.currency,
    s.default_price_term, s.payment_terms, s.lead_time_days,
    s.finansit_code?.trim() || null, s.finansit_default_price_code?.trim() || null, s.is_active,
  ])

  return insertChunked(
    client,
    (values) => `
      INSERT INTO dashboard.xpart_suppliers
        (xpart_supplier_id, code, name, role, currency, default_price_term,
         payment_terms, lead_time_days, finansit_code, finansit_price_code, active)
      VALUES ${values}
      ON CONFLICT (xpart_supplier_id) DO UPDATE SET
        code = EXCLUDED.code, name = EXCLUDED.name, role = EXCLUDED.role,
        currency = EXCLUDED.currency, default_price_term = EXCLUDED.default_price_term,
        payment_terms = EXCLUDED.payment_terms, lead_time_days = EXCLUDED.lead_time_days,
        finansit_code = EXCLUDED.finansit_code, finansit_price_code = EXCLUDED.finansit_price_code,
        active = EXCLUDED.active, synced_at = now()`,
    rows,
    11,
  )
}

/**
 * Merge Xpart's supplier records into our own supplier_profiles, joined on the
 * ERP supplier code.
 *
 * Deliberately additive: an existing profile only has blanks filled in, never
 * overwritten, because whatever a human typed here beats what an import
 * guessed. Suppliers Xpart knows and we do not get a new profile row; the ones
 * with no ERP account at all (Lubinski, ORLYD, SOEX) are skipped, since
 * supplier_profiles is keyed by ERP code and has nothing to hang them on.
 */
async function mergeSupplierProfiles(client: PoolClient): Promise<number> {
  const res = await client.query(`
    WITH src AS (
      SELECT finansit_code, name, lead_time_days, payment_terms
        FROM dashboard.xpart_suppliers
       WHERE finansit_code IS NOT NULL AND finansit_code <> '' AND active
    ),
    updated AS (
      UPDATE dashboard.supplier_profiles p
         SET lead_time_days = COALESCE(p.lead_time_days, src.lead_time_days),
             payment_terms  = COALESCE(NULLIF(p.payment_terms, ''), src.payment_terms),
             notes          = COALESCE(NULLIF(p.notes, ''), 'Xpart: ' || src.name),
             updated_at     = now()
        FROM src
       WHERE p.supplier_code = src.finansit_code
         -- Only when there is actually a blank to fill, so a nightly run does
         -- not restamp updated_at on rows nothing changed about.
         AND (
           (p.lead_time_days IS NULL AND src.lead_time_days IS NOT NULL)
           OR (NULLIF(p.payment_terms, '') IS NULL AND src.payment_terms IS NOT NULL)
           OR NULLIF(p.notes, '') IS NULL
         )
      RETURNING p.id
    ),
    inserted AS (
      INSERT INTO dashboard.supplier_profiles
        (supplier_code, supplier_name, lead_time_days, payment_terms, notes, active)
      SELECT src.finansit_code, src.name, src.lead_time_days, src.payment_terms,
             'Imported from Xpart', true
        FROM src
       WHERE NOT EXISTS (
         SELECT 1 FROM dashboard.supplier_profiles p WHERE p.supplier_code = src.finansit_code
       )
      RETURNING id
    )
    SELECT (SELECT count(*) FROM updated) + (SELECT count(*) FROM inserted) AS merged`)
  return Number(res.rows[0]?.merged ?? 0)
}

// ── Prices ─────────────────────────────────────────────────────────────────

async function syncPrices(
  client: PoolClient,
  syncId: string,
  erpCodes: Set<string>,
): Promise<{ upserted: number; removed: number; unknownParts: Map<string, PriceRow[]> }> {
  // FX is resolved on the Xpart side because that is where the Bank-of-Israel
  // rates live (currency_rates, refreshed daily by its own timer).
  const rows = await xpartQuery<PriceRow>(
    `WITH fx AS (
       SELECT DISTINCT ON (from_currency) from_currency, rate
         FROM currency_rates WHERE to_currency = 'ILS'
        ORDER BY from_currency, effective_date DESC
     )
     SELECT sp.part_number,
            s.code                          AS supplier_code,
            s.name                          AS supplier_name,
            s.supplier_role                 AS supplier_role,
            sp.price::float8                AS price,
            sp.currency,
            sp.price_term,
            sp.availability_status,
            sp.lead_time_days,
            sp.minimum_quantity,
            pl.name                         AS price_list_name,
            pl.effective_date,
            COALESCE(ti.import_markup, 1.3)::float8 AS import_markup,
            (CASE WHEN sp.currency = 'ILS' THEN 1 ELSE COALESCE(fx.rate, 1) END)::float8 AS fx_to_ils
       FROM supplier_prices sp
       JOIN suppliers s ON s.supplier_id = sp.supplier_id
       LEFT JOIN supplier_price_lists pl ON pl.price_list_id = sp.price_list_id
       LEFT JOIN tenant_items ti ON ti.item_id = sp.item_id AND ti.tenant_id = sp.tenant_id
       LEFT JOIN fx ON fx.from_currency = sp.currency
      WHERE sp.tenant_id = $1 AND sp.is_active AND sp.price > 0`,
    [XPART_TENANT_ID],
  )

  // One supplier can quote the same part number more than once upstream — Xpart
  // keys prices by (supplier, brand, part, price list), so a part carried in
  // both the standard and a promotional list, or under two brands, arrives
  // twice. We keep one row per (supplier, part): the cheapest, because that is
  // what we would actually pay. Retail is the exception — there the newest list
  // is the current shelf price, not the lowest one we ever saw.
  const bestByKey = new Map<string, { row: PriceRow; landed: number; isRetail: boolean }>()
  const unknownParts = new Map<string, PriceRow[]>()

  for (const r of rows) {
    const code = (r.part_number || '').trim()
    if (!code) continue
    if (!erpCodes.has(code)) {
      const list = unknownParts.get(code)
      if (list) list.push(r)
      else unknownParts.set(code, [r])
      continue
    }
    // The official distributor's list is the retail baseline, not a purchase
    // option: it is already ILS and carries no import markup.
    const isRetail = r.supplier_role === 'official_distributor'
    const landed = isRetail ? r.price : r.price * r.import_markup * r.fx_to_ils
    const key = `${r.supplier_code.trim()}|${code}`
    const held = bestByKey.get(key)
    if (!held) {
      bestByKey.set(key, { row: r, landed, isRetail })
      continue
    }
    const better = isRetail
      ? (r.effective_date ?? '') > (held.row.effective_date ?? '')
      : landed < held.landed
    if (better) bestByKey.set(key, { row: r, landed, isRetail })
  }

  const known: unknown[][] = []
  for (const [, { row: r, landed, isRetail }] of bestByKey) {
    known.push([
      syncId, r.part_number.trim(), r.supplier_code.trim(), r.supplier_name.trim(), isRetail,
      r.price, r.currency, isRetail ? 1 : r.fx_to_ils, isRetail ? 1 : r.import_markup, landed,
      r.price_term, r.availability_status, r.lead_time_days, r.minimum_quantity,
      r.price_list_name, r.effective_date,
    ])
  }

  const upserted = await insertChunked(
    client,
    (values) => `
      INSERT INTO dashboard.xpart_supplier_prices
        (sync_id, item_code, supplier_code, supplier_name, is_retail, price, currency,
         fx_to_ils, import_markup, landed_ils, price_term, availability_status,
         lead_time_days, minimum_quantity, price_list_name, effective_date)
      VALUES ${values}
      ON CONFLICT (supplier_code, item_code) DO UPDATE SET
        sync_id = EXCLUDED.sync_id, supplier_name = EXCLUDED.supplier_name,
        is_retail = EXCLUDED.is_retail, price = EXCLUDED.price, currency = EXCLUDED.currency,
        fx_to_ils = EXCLUDED.fx_to_ils, import_markup = EXCLUDED.import_markup,
        landed_ils = EXCLUDED.landed_ils, price_term = EXCLUDED.price_term,
        availability_status = EXCLUDED.availability_status,
        lead_time_days = EXCLUDED.lead_time_days, minimum_quantity = EXCLUDED.minimum_quantity,
        price_list_name = EXCLUDED.price_list_name, effective_date = EXCLUDED.effective_date,
        updated_at = now()`,
    known,
    16,
  )

  // Anything this run did not touch is a price that went inactive upstream.
  const del = await client.query(
    `DELETE FROM dashboard.xpart_supplier_prices WHERE sync_id <> $1`,
    [syncId],
  )

  return { upserted, removed: del.rowCount ?? 0, unknownParts }
}

// ── Chains ─────────────────────────────────────────────────────────────────

async function syncChains(
  client: PoolClient,
  erpCodes: Set<string>,
  erpLinks: Array<{ code: string; new_item_id?: string; old_item_id?: string }>,
): Promise<{ seen: number; added: number }> {
  // Both directions, because "does the ERP already know these two are the same
  // part" has no direction — only our old→new labelling does.
  const erpPairs = new Set<string>()
  for (const l of erpLinks) {
    if (l.new_item_id) {
      erpPairs.add(`${l.code}|${l.new_item_id}`)
      erpPairs.add(`${l.new_item_id}|${l.code}`)
    }
    if (l.old_item_id) {
      erpPairs.add(`${l.code}|${l.old_item_id}`)
      erpPairs.add(`${l.old_item_id}|${l.code}`)
    }
  }

  const chains = await xpartQuery<{
    old_code: string
    new_code: string
    replacement_type: string | null
  }>(
    `SELECT oi.part_number AS old_code, ni.part_number AS new_code, r.replacement_type
       FROM item_replacements r
       JOIN items oi ON oi.item_id = r.old_item_id
       JOIN items ni ON ni.item_id = r.new_item_id
      WHERE r.tenant_id = $1`,
    [XPART_TENANT_ID],
  )

  const rows: unknown[][] = []
  const seenPairs = new Set<string>()
  for (const c of chains) {
    const oldCode = (c.old_code || '').trim()
    const newCode = (c.new_code || '').trim()
    if (!oldCode || !newCode || oldCode === newCode) continue
    // Same guard the analytics chain map uses: Finansit's freight/service
    // placeholder codes carry links into real parts and would fuse unrelated
    // chains together.
    if (isPlaceholderCode(oldCode) || isPlaceholderCode(newCode)) continue
    const key = `${oldCode}|${newCode}`
    if (seenPairs.has(key)) continue
    seenPairs.add(key)
    rows.push([
      oldCode, newCode, c.replacement_type, erpPairs.has(key),
      erpCodes.has(oldCode), erpCodes.has(newCode),
    ])
  }

  await insertChunked(
    client,
    (values) => `
      INSERT INTO dashboard.xpart_chains
        (old_code, new_code, replacement_type, in_erp, old_in_erp, new_in_erp)
      VALUES ${values}
      ON CONFLICT (old_code, new_code) DO UPDATE SET
        replacement_type = EXCLUDED.replacement_type, in_erp = EXCLUDED.in_erp,
        old_in_erp = EXCLUDED.old_in_erp, new_in_erp = EXCLUDED.new_in_erp,
        last_seen_at = now()`,
    rows,
    6,
  )

  const added = await client.query<{ count: string }>(
    `SELECT count(*) AS count FROM dashboard.xpart_chains WHERE in_erp = false`,
  )
  return { seen: rows.length, added: Number(added.rows[0]?.count ?? 0) }
}

// ── New part numbers ───────────────────────────────────────────────────────

async function syncNewParts(
  client: PoolClient,
  erpCodes: Set<string>,
  unknownParts: Map<string, PriceRow[]>,
): Promise<number> {
  if (unknownParts.size === 0) return 0

  const meta = await xpartQuery<{ part_number: string; brand: string | null; description: string | null }>(
    `WITH d AS (
       SELECT DISTINCT ON (item_id) item_id, description
         FROM item_descriptions
        ORDER BY item_id, (language = 'he') DESC, is_primary DESC
     )
     SELECT i.part_number, b.code AS brand, left(d.description, 200) AS description
       FROM items i
       LEFT JOIN brands b ON b.brand_id = i.brand_id
       LEFT JOIN d ON d.item_id = i.item_id`,
  )
  const metaByPart = new Map(meta.map((m) => [m.part_number.trim(), m]))

  const rows: unknown[][] = []
  for (const [partNumber, prices] of unknownParts) {
    if (erpCodes.has(partNumber)) continue // belt and braces
    const retail = prices.find((p) => p.supplier_role === 'official_distributor')
    const purchasable = prices.filter((p) => p.supplier_role !== 'official_distributor')
    let cheapest: { row: PriceRow; landed: number } | null = null
    for (const p of purchasable) {
      const landed = p.price * p.import_markup * p.fx_to_ils
      if (!cheapest || landed < cheapest.landed) cheapest = { row: p, landed }
    }
    const m = metaByPart.get(partNumber)
    rows.push([
      partNumber,
      m?.brand ?? null,
      m?.description ?? null,
      purchasable.length,
      cheapest?.row.supplier_code.trim() ?? null,
      cheapest?.row.price ?? null,
      cheapest?.row.currency ?? null,
      cheapest?.landed ?? null,
      retail?.price ?? null,
      Boolean(retail),
    ])
  }

  return insertChunked(
    client,
    (values) => `
      INSERT INTO dashboard.xpart_new_parts
        (part_number, brand, description, supplier_count, cheapest_supplier_code,
         cheapest_price, cheapest_currency, cheapest_landed_ils, retail_ils, in_retail_list)
      VALUES ${values}
      ON CONFLICT (part_number) DO UPDATE SET
        brand = EXCLUDED.brand, description = EXCLUDED.description,
        supplier_count = EXCLUDED.supplier_count,
        cheapest_supplier_code = EXCLUDED.cheapest_supplier_code,
        cheapest_price = EXCLUDED.cheapest_price,
        cheapest_currency = EXCLUDED.cheapest_currency,
        cheapest_landed_ils = EXCLUDED.cheapest_landed_ils,
        retail_ils = EXCLUDED.retail_ils, in_retail_list = EXCLUDED.in_retail_list,
        last_seen_at = now()`,
    rows,
    10,
  )
}
