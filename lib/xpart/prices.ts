import { readQueryAsync } from '@/lib/neon-read'

/**
 * Reads over the mirrored Xpart supplier prices (dashboard.xpart_supplier_prices,
 * refreshed by app/api/cron/xpart-sync).
 *
 * These hit Neon, not Xpart — the mirror is what makes them fast enough to put on
 * a page, and it means these two screens keep working even when Xpart's Supabase
 * is unreachable. Our own cost and retail still come from FINAPI; nothing here
 * touches them.
 */

export interface ItemSupplierPrice {
  supplier_code: string
  supplier_name: string
  is_retail: boolean
  price: number
  currency: string
  fx_to_ils: number | null
  import_markup: number | null
  landed_ils: number | null
  price_term: string | null
  availability_status: string | null
  lead_time_days: number | null
  minimum_quantity: number | null
  price_list_name: string | null
  effective_date: string | null
}

/** Every supplier's price for one part, cheapest purchase option first, retail last. */
export async function getItemSupplierPrices(itemCode: string): Promise<ItemSupplierPrice[]> {
  const res = await readQueryAsync(
    `SELECT supplier_code, supplier_name, is_retail, price, currency, fx_to_ils,
            import_markup, landed_ils, price_term, availability_status,
            lead_time_days, minimum_quantity, price_list_name, effective_date
       FROM dashboard.xpart_supplier_prices
      WHERE item_code = $1
      ORDER BY is_retail, landed_ils`,
    [itemCode],
  )
  return res.rows as ItemSupplierPrice[]
}

export interface SupplierCatalogRow {
  item_code: string
  price: number
  currency: string
  landed_ils: number | null
  price_term: string | null
  availability_status: string | null
  lead_time_days: number | null
  price_list_name: string | null
  effective_date: string | null
  retail_ils: number | null
  margin_pct: number | null
  best_other_ils: number | null
  best_other_supplier: string | null
  /** Positive when somebody else is cheaper for this part — i.e. we are overpaying here. */
  cheaper_elsewhere_ils: number | null
}

export type SupplierCatalogSort =
  | 'item_code'
  | 'price'
  | 'landed_ils'
  | 'retail_ils'
  | 'margin_pct'
  | 'cheaper_elsewhere_ils'

/**
 * Bare column names, not qualified ones: the ORDER BY runs on the outer query,
 * which selects FROM joined — `m` and `r` only exist inside that CTE. Qualifying
 * them here fails with "missing FROM-clause entry for table m", and only for the
 * sorts that carry a prefix, which is why it survived a test that happened to
 * use one of the two unqualified keys.
 */
const SORT_SQL: Record<SupplierCatalogSort, string> = {
  item_code: 'item_code',
  price: 'price',
  landed_ils: 'landed_ils',
  retail_ils: 'retail_ils',
  margin_pct: 'margin_pct',
  cheaper_elsewhere_ils: 'cheaper_elsewhere_ils',
}

/**
 * One supplier's priced catalog, with the two comparisons that make it worth
 * looking at: margin against the official distributor's retail, and whether
 * another supplier quotes the same part for less.
 *
 * The supplier is addressed by its Xpart code (xpart_suppliers.code), not the
 * ERP code — callers translate via xpart_suppliers.finansit_code.
 */
export async function getSupplierCatalog(
  supplierCode: string,
  opts: {
    search?: string
    sort?: SupplierCatalogSort
    dir?: 'asc' | 'desc'
    limit?: number
    offset?: number
    onlyCheaperElsewhere?: boolean
  } = {},
): Promise<{ rows: SupplierCatalogRow[]; total: number }> {
  const sort = SORT_SQL[opts.sort ?? 'landed_ils'] ?? SORT_SQL.landed_ils
  const dir = opts.dir === 'asc' ? 'ASC' : 'DESC'
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  const search = opts.search?.trim() || null

  // NULLS LAST on both directions: a row with no retail (so no margin) is
  // "unknown", not "worst", and floating it to the top of a margin sort buries
  // the rows the page exists to show.
  const sql = `
    WITH mine AS (
      SELECT * FROM dashboard.xpart_supplier_prices
       WHERE supplier_code = $1 AND NOT is_retail
         AND ($2::text IS NULL OR item_code ILIKE '%' || $2 || '%')
    ),
    best_other AS (
      SELECT DISTINCT ON (p.item_code)
             p.item_code, p.landed_ils AS best_other_ils, p.supplier_name AS best_other_supplier
        FROM dashboard.xpart_supplier_prices p
        JOIN mine ON mine.item_code = p.item_code
       WHERE NOT p.is_retail AND p.supplier_code <> $1
       ORDER BY p.item_code, p.landed_ils
    ),
    retail AS (
      SELECT p.item_code, p.price AS retail_ils
        FROM dashboard.xpart_supplier_prices p
        JOIN mine ON mine.item_code = p.item_code
       WHERE p.is_retail
    ),
    joined AS (
      SELECT m.item_code, m.price, m.currency, m.landed_ils, m.price_term,
             m.availability_status, m.lead_time_days, m.price_list_name, m.effective_date,
             r.retail_ils,
             CASE WHEN r.retail_ils > 0 AND m.landed_ils IS NOT NULL
                  THEN (1 - m.landed_ils / r.retail_ils) * 100 END AS margin_pct,
             b.best_other_ils, b.best_other_supplier,
             CASE WHEN b.best_other_ils IS NOT NULL AND m.landed_ils IS NOT NULL
                       AND b.best_other_ils < m.landed_ils
                  THEN m.landed_ils - b.best_other_ils END AS cheaper_elsewhere_ils
        FROM mine m
        LEFT JOIN best_other b ON b.item_code = m.item_code
        LEFT JOIN retail r ON r.item_code = m.item_code
    )
    SELECT *, count(*) OVER () AS total_count
      FROM joined
     WHERE ($3::boolean IS NOT TRUE OR cheaper_elsewhere_ils IS NOT NULL)
     ORDER BY ${sort} ${dir} NULLS LAST, item_code
     LIMIT ${limit} OFFSET ${offset}`

  const res = await readQueryAsync(sql, [supplierCode, search, opts.onlyCheaperElsewhere ?? false])
  // count(*) OVER () rides along on every row so the total and the page come
  // back in one query; it is stripped here rather than leaked into the payload.
  const rows = res.rows as Array<SupplierCatalogRow & { total_count: number }>
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0
  return {
    rows: rows.map(row => {
      const copy: SupplierCatalogRow & { total_count?: number } = { ...row }
      delete copy.total_count
      return copy
    }),
    total,
  }
}

/** Headline numbers for a supplier's catalog — computed over the whole set, not the page. */
export async function getSupplierCatalogSummary(supplierCode: string): Promise<{
  items: number
  withRetail: number
  avgMarginPct: number | null
  cheaperElsewhere: number
  overpayIls: number
}> {
  const res = await readQueryAsync(
    `WITH mine AS (
       SELECT * FROM dashboard.xpart_supplier_prices
        WHERE supplier_code = $1 AND NOT is_retail
     ),
     best_other AS (
       SELECT p.item_code, min(p.landed_ils) AS best_other_ils
         FROM dashboard.xpart_supplier_prices p
         JOIN mine ON mine.item_code = p.item_code
        WHERE NOT p.is_retail AND p.supplier_code <> $1
        GROUP BY p.item_code
     ),
     retail AS (
       SELECT p.item_code, p.price AS retail_ils
         FROM dashboard.xpart_supplier_prices p
         JOIN mine ON mine.item_code = p.item_code
        WHERE p.is_retail
     )
     SELECT count(*)::int AS items,
            count(r.retail_ils)::int AS with_retail,
            avg(CASE WHEN r.retail_ils > 0 THEN (1 - m.landed_ils / r.retail_ils) * 100 END) AS avg_margin_pct,
            count(*) FILTER (WHERE b.best_other_ils < m.landed_ils)::int AS cheaper_elsewhere,
            COALESCE(sum(m.landed_ils - b.best_other_ils)
                     FILTER (WHERE b.best_other_ils < m.landed_ils), 0) AS overpay_ils
       FROM mine m
       LEFT JOIN best_other b ON b.item_code = m.item_code
       LEFT JOIN retail r ON r.item_code = m.item_code`,
    [supplierCode],
  )
  const r = (res.rows as Array<Record<string, number | null>>)[0]
  return {
    items: Number(r?.items ?? 0),
    withRetail: Number(r?.with_retail ?? 0),
    avgMarginPct: r?.avg_margin_pct == null ? null : Number(r.avg_margin_pct),
    cheaperElsewhere: Number(r?.cheaper_elsewhere ?? 0),
    overpayIls: Number(r?.overpay_ils ?? 0),
  }
}

/** ERP supplier code (supplier_profiles.supplier_code) → Xpart supplier code. */
export async function resolveXpartSupplierCode(erpCode: string): Promise<string | null> {
  const res = await readQueryAsync(
    `SELECT code FROM dashboard.xpart_suppliers WHERE finansit_code = $1 AND active LIMIT 1`,
    [erpCode],
  )
  return (res.rows as Array<{ code: string }>)[0]?.code ?? null
}
