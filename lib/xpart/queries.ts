import { xpartQuery, XPART_TENANT_ID } from '@/lib/xpart-db'

/**
 * Every live read against Xpart-v2's Supabase lives here.
 *
 * One module on purpose: we are a guest in another app's database and its team
 * migrates without telling us. When a column moves, exactly one file breaks and
 * every screen degrades to an empty state instead of a 500.
 *
 * Xpart's own screens get most of these numbers from SECURITY DEFINER RPCs. We
 * hold a plain SELECT-only login, so the RPC bodies are reimplemented as
 * queries; where the two would disagree, the divergence is commented.
 *
 * ── On landed cost ──
 * Xpart computes cost two different ways in two different screens:
 *   price-list screen   (price / price_term_factor) * import_markup * fx
 *   comparison screen    price * import_markup * fx
 * 99.7% of supplier_prices rows carry NO price_term, and the price-list RPC
 * COALESCEs that to 'EXW', whose factor is 0.9 — so it silently reports costs
 * 11.1% higher than the comparison screen for essentially the whole catalog.
 * The comparison screen is the one orders are placed from and the one that
 * matches Finansit, so this file uses that convention everywhere. Numbers here
 * will therefore read ~11% below Xpart's price-list page, and that is deliberate.
 */

const T = XPART_TENANT_ID

/** Latest rate per currency → ILS. Xpart refreshes these daily from Bank of Israel. */
const FX_CTE = `
  fx AS (
    SELECT DISTINCT ON (from_currency) from_currency, rate
      FROM currency_rates WHERE to_currency = 'ILS'
     ORDER BY from_currency, effective_date DESC
  )`

export interface PriceListSummary {
  price_list_id: string
  supplier_id: string | null
  /** ERP supplier code — the join to /suppliers/[code]. Null for the three
   *  Xpart suppliers with no ERP account (Lubinski, ORLYD, SOEX). */
  supplier_finansit_code: string | null
  name: string
  version: number | null
  currency: string
  status: string
  is_promotional: boolean
  total_items: number | null
  effective_date: string | null
  expiry_date: string | null
  created_at: string
  supplier_name: string | null
  supplier_role: string | null
}

/**
 * Price lists, newest first. Drafts are excluded — they are half-finished
 * imports and Xpart hides them from its own list too.
 */
export async function listPriceLists(): Promise<PriceListSummary[]> {
  return xpartQuery<PriceListSummary>(
    `SELECT pl.price_list_id, btrim(pl.name, E' \t\r\n') AS name, pl.version, pl.currency, pl.status,
            COALESCE(pl.is_promotional, false) AS is_promotional,
            pl.total_items, pl.effective_date, pl.expiry_date, pl.created_at,
            s.name AS supplier_name, s.supplier_role, s.supplier_id,
            NULLIF(btrim(s.finansit_code), '') AS supplier_finansit_code
       FROM supplier_price_lists pl
       LEFT JOIN suppliers s ON s.supplier_id = pl.supplier_id
      WHERE pl.tenant_id = $1 AND pl.status IN ('active','archived')
      ORDER BY pl.effective_date DESC NULLS LAST, pl.created_at DESC`,
    [T],
  )
}

export interface PriceListDetail extends PriceListSummary {
  supplier_id: string
  changes: { increase: number; decrease: number; new: number; discontinued: number }
  fx_rate: number | null
}

export async function getPriceListDetail(priceListId: string): Promise<PriceListDetail | null> {
  const [header] = await xpartQuery<PriceListSummary & { supplier_id: string }>(
    `SELECT pl.price_list_id, btrim(pl.name, E' \t\r\n') AS name, pl.version, pl.currency, pl.status,
            COALESCE(pl.is_promotional, false) AS is_promotional,
            pl.total_items, pl.effective_date, pl.expiry_date, pl.created_at,
            pl.supplier_id, s.name AS supplier_name, s.supplier_role
       FROM supplier_price_lists pl
       LEFT JOIN suppliers s ON s.supplier_id = pl.supplier_id
      WHERE pl.price_list_id = $1 AND pl.tenant_id = $2`,
    [priceListId, T],
  )
  if (!header) return null

  const [changes, fx] = await Promise.all([
    xpartQuery<{ change_type: string; n: string }>(
      `SELECT change_type, count(*)::text AS n FROM price_history
        WHERE price_list_id = $1 GROUP BY change_type`,
      [priceListId],
    ),
    xpartQuery<{ rate: number }>(
      `SELECT rate FROM currency_rates
        WHERE from_currency = $1 AND to_currency = 'ILS'
        ORDER BY effective_date DESC LIMIT 1`,
      [header.currency],
    ),
  ])

  const counts = { increase: 0, decrease: 0, new: 0, discontinued: 0 }
  for (const c of changes) {
    if (c.change_type in counts) counts[c.change_type as keyof typeof counts] = Number(c.n)
  }

  return {
    ...header,
    changes: counts,
    fx_rate: header.currency === 'ILS' ? 1 : (fx[0]?.rate ?? null),
  }
}

export interface PriceListItem {
  part_number: string
  brand_name: string | null
  description_he: string | null
  description_en: string | null
  price: number
  currency: string
  cost_ils: number | null
  retail_ils: number | null
  margin_pct: number | null
  availability_status: string | null
  lead_time_days: number | null
}

/**
 * Sortable columns, and why retail and margin are not among them.
 *
 * Ordering a 492k-row list by margin means computing every row's retail first:
 * 20s as a hash join, 60s+ as the correlated lookup Xpart's RPC uses. Worse, the
 * result is junk — the top of that ordering is parts priced at €0.06 against a
 * ₪186 retail that belongs to a different part, so it reads as "99.9% margin"
 * on scrap. Margin is shown per row; the screen for "which rows deserve
 * attention" is the opportunities view, which thresholds on savings instead.
 */
export type PriceListItemSort = 'part_number' | 'brand_name' | 'price' | 'cost_ils'

const ITEM_SORT_SQL: Record<PriceListItemSort, string> = {
  part_number: 'sp.part_number',
  brand_name: 'b.name',
  price: 'sp.price',
  cost_ils: 'cost_ils',
}

/**
 * One page of a price list, with cost, the official distributor's retail, and
 * the margin between them.
 *
 * Retail matching bridges brands.retail_prefix: MG parts carry the prefix on the
 * ERP/retail side but not in the supplier's own list, so an exact join finds
 * nothing for a whole brand.
 *
 * No total count is computed — supplier_price_lists.total_items already holds
 * it, and counting 492k rows to render 50 of them costs more than the page.
 */
export async function getPriceListItems(
  priceListId: string,
  opts: {
    search?: string
    sort?: PriceListItemSort
    dir?: 'asc' | 'desc'
    limit?: number
    offset?: number
  } = {},
): Promise<PriceListItem[]> {
  const sort = ITEM_SORT_SQL[opts.sort ?? 'part_number'] ?? ITEM_SORT_SQL.part_number
  const dir = opts.dir === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)

  return xpartQuery<PriceListItem>(
    `WITH ${FX_CTE},
     v AS (
       SELECT (SELECT supplier_id FROM suppliers
                WHERE tenant_id = $1 AND supplier_role = 'official_distributor' AND is_active
                LIMIT 1) AS official_id,
              (SELECT supplier_id FROM supplier_price_lists WHERE price_list_id = $2) AS list_supplier_id
     )
     SELECT sp.part_number, b.name AS brand_name,
            he.description AS description_he, en.description AS description_en,
            sp.price::float8 AS price, sp.currency,
            cost.v::float8 AS cost_ils,
            retail.v::float8 AS retail_ils,
            CASE WHEN retail.v > 0 AND cost.v IS NOT NULL
                 THEN ((1 - cost.v / retail.v) * 100)::float8 END AS margin_pct,
            sp.availability_status, sp.lead_time_days
       FROM supplier_prices sp
       CROSS JOIN v
       JOIN brands b ON b.brand_id = sp.brand_id
       LEFT JOIN items i ON i.brand_id = sp.brand_id AND i.part_number = sp.part_number
       LEFT JOIN tenant_items ti ON ti.item_id = i.item_id AND ti.tenant_id = $1
       LEFT JOIN fx ON fx.from_currency = sp.currency
       LEFT JOIN LATERAL (SELECT d.description FROM item_descriptions d
                           WHERE d.item_id = i.item_id AND d.language = 'he'
                           ORDER BY (d.is_primary IS TRUE) DESC, d.created_at DESC NULLS LAST
                           LIMIT 1) he ON TRUE
       LEFT JOIN LATERAL (SELECT d.description FROM item_descriptions d
                           WHERE d.item_id = i.item_id AND d.language = 'en'
                           ORDER BY (d.is_primary IS TRUE) DESC, d.created_at DESC NULLS LAST
                           LIMIT 1) en ON TRUE
       LEFT JOIN LATERAL (
         SELECT rsp.price FROM supplier_prices rsp
          WHERE rsp.tenant_id = $1 AND rsp.supplier_id = v.official_id
            AND rsp.brand_id = sp.brand_id AND rsp.is_active
            AND rsp.part_number = CASE
                  WHEN b.retail_prefix IS NOT NULL AND b.retail_prefix <> ''
                       AND sp.part_number LIKE b.retail_prefix || '%'
                  THEN substring(sp.part_number FROM length(b.retail_prefix) + 1)
                  ELSE sp.part_number END
          LIMIT 1) retail_sp ON TRUE
       -- The official distributor's own list IS retail: no markup, no FX, and
       -- margin against itself is meaningless rather than zero.
       CROSS JOIN LATERAL (SELECT CASE
              WHEN v.list_supplier_id = v.official_id THEN sp.price
              ELSE sp.price * COALESCE(ti.import_markup, 1.30)
                   * COALESCE(fx.rate, CASE WHEN sp.currency = 'ILS' THEN 1.0 END)
            END AS v) cost
       CROSS JOIN LATERAL (SELECT CASE
              WHEN v.list_supplier_id = v.official_id THEN NULL
              ELSE retail_sp.price END AS v) retail
      WHERE sp.price_list_id = $2
        AND ($3::text IS NULL OR sp.part_number ILIKE '%' || $3 || '%')
      ORDER BY ${sort} ${dir} NULLS LAST, sp.part_number
      LIMIT ${limit} OFFSET ${offset}`,
    [T, priceListId, opts.search?.trim() || null],
  )
}

export interface PriceChange {
  part_number: string
  brand_name: string | null
  description_he: string | null
  description_en: string | null
  old_price: number | null
  new_price: number | null
  change_type: string
  change_percentage: number | null
}

/**
 * The rows behind one of the four change tiles.
 *
 * minAbsPct filters on the magnitude of the move — a list with 414k decreases is
 * unreadable until you ask for the ones that actually matter.
 */
export async function getPriceChanges(
  priceListId: string,
  opts: { changeType?: string; minAbsPct?: number; limit?: number; offset?: number } = {},
): Promise<PriceChange[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const offset = Math.max(opts.offset ?? 0, 0)
  return xpartQuery<PriceChange>(
    `SELECT ph.part_number, b.name AS brand_name,
            he.description AS description_he, en.description AS description_en,
            ph.old_price::float8 AS old_price, ph.new_price::float8 AS new_price,
            ph.change_type, ph.change_percentage::float8 AS change_percentage
       FROM price_history ph
       LEFT JOIN brands b ON b.brand_id = ph.brand_id
       LEFT JOIN items i ON i.brand_id = ph.brand_id AND i.part_number = ph.part_number
       LEFT JOIN LATERAL (SELECT d.description FROM item_descriptions d
                           WHERE d.item_id = i.item_id AND d.language = 'he'
                           ORDER BY (d.is_primary IS TRUE) DESC, d.created_at DESC NULLS LAST
                           LIMIT 1) he ON TRUE
       LEFT JOIN LATERAL (SELECT d.description FROM item_descriptions d
                           WHERE d.item_id = i.item_id AND d.language = 'en'
                           ORDER BY (d.is_primary IS TRUE) DESC, d.created_at DESC NULLS LAST
                           LIMIT 1) en ON TRUE
      WHERE ph.price_list_id = $1
        AND ($2::text IS NULL OR ph.change_type = $2)
        AND ($3::numeric <= 0 OR (ph.change_percentage IS NOT NULL
                                  AND abs(ph.change_percentage) >= $3))
      ORDER BY COALESCE(abs(ph.change_percentage), 0) DESC, ph.part_number
      LIMIT ${limit} OFFSET ${offset}`,
    [priceListId, opts.changeType || null, opts.minAbsPct ?? 0],
  )
}

export interface OpenOrder {
  order_id: string
  order_number: string
  supplier_name: string | null
  supplier_finansit_code: string | null
  status: string
  order_date: string | null
  expected_delivery: string | null
  finansit_doc_number: string | null
  finansit_doc_format: string | null
  total_items: number | null
  total_value: number | null
  currency: string | null
  inquiry_number: string | null
  days_open: number | null
}

/**
 * Purchase orders that have been placed and not yet received — the goods on the
 * water.
 *
 * The dashboard's own /shipments only knows about cartons once they have been
 * scanned in the warehouse, so everything between "we ordered it" and "it
 * arrived" was invisible here. Xpart holds that stretch: 150 submitted orders,
 * every one carrying the Finansit 61 document number it was pushed to.
 *
 * expected_delivery is NULL on every row in practice, so there is no ETA to
 * report — days_open is what the screen has instead, and it is honest about
 * being an age rather than a forecast.
 */
export async function getOpenOrders(): Promise<OpenOrder[]> {
  return xpartQuery<OpenOrder>(
    `SELECT o.order_id, o.order_number,
            s.name AS supplier_name, s.finansit_code AS supplier_finansit_code,
            o.status, o.order_date, o.expected_delivery,
            o.finansit_doc_number, o.finansit_doc_format,
            o.total_items, o.total_value::float8 AS total_value, o.currency,
            i.inquiry_number,
            (CURRENT_DATE - o.order_date::date) AS days_open
       FROM orders o
       LEFT JOIN suppliers s ON s.supplier_id = o.supplier_id
       LEFT JOIN inquiries i ON i.inquiry_id = o.inquiry_id
      WHERE o.tenant_id = $1 AND o.status = 'submitted'
      ORDER BY o.order_date DESC NULLS LAST`,
    [T],
  )
}

export interface InquirySummary {
  inquiry_id: string
  inquiry_number: string
  status: string
  total_items: number | null
  customer_reference: string | null
  notes: string | null
  created_at: string
  finansit_doc_number: string | null
  created_by_name: string | null
  snapshot_status: string | null
  snapshot_computed_at: string | null
}

/** Inquiries, newest first, each with the state of its comparison snapshot. */
export async function listInquiries(): Promise<InquirySummary[]> {
  return xpartQuery<InquirySummary>(
    `SELECT i.inquiry_id, i.inquiry_number, i.status, i.total_items,
            i.customer_reference, i.notes, i.created_at, i.finansit_doc_number,
            u.full_name AS created_by_name,
            s.status AS snapshot_status, s.computed_at AS snapshot_computed_at
       FROM inquiries i
       LEFT JOIN users u ON u.user_id = i.created_by
       LEFT JOIN inquiry_comparison_snapshots s ON s.inquiry_id = i.inquiry_id
      WHERE i.tenant_id = $1
      ORDER BY i.created_at DESC`,
    [T],
  )
}

export interface InquiryItem {
  inquiry_item_id: string
  row_number: number | null
  brand_name: string | null
  part_number: string
  item_id: string | null
  description: string | null
  quantity: number | null
  reference_price: number | null
  reference_currency: string | null
  quality_grade: string | null
}

export async function getInquiryItems(
  inquiryId: string,
  opts: { limit?: number; offset?: number; search?: string } = {},
): Promise<InquiryItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const offset = Math.max(opts.offset ?? 0, 0)
  return xpartQuery<InquiryItem>(
    `SELECT ii.inquiry_item_id, ii.row_number, b.name AS brand_name, ii.part_number,
            ii.item_id, ii.description, ii.quantity,
            ii.reference_price::float8 AS reference_price, ii.reference_currency,
            ii.quality_grade
       FROM inquiry_items ii
       LEFT JOIN brands b ON b.brand_id = ii.brand_id
      WHERE ii.inquiry_id = $1
        AND ($2::text IS NULL OR ii.part_number ILIKE '%' || $2 || '%')
      ORDER BY ii.row_number NULLS LAST, ii.part_number
      LIMIT ${limit} OFFSET ${offset}`,
    [inquiryId, opts.search?.trim() || null],
  )
}

export interface InquiryHeader extends InquirySummary {
  currency: string | null
}

export async function getInquiry(inquiryId: string): Promise<InquiryHeader | null> {
  const [row] = await xpartQuery<InquiryHeader>(
    `SELECT i.inquiry_id, i.inquiry_number, i.status, i.total_items,
            i.customer_reference, i.notes, i.created_at, i.finansit_doc_number, i.currency,
            u.full_name AS created_by_name,
            s.status AS snapshot_status, s.computed_at AS snapshot_computed_at
       FROM inquiries i
       LEFT JOIN users u ON u.user_id = i.created_by
       LEFT JOIN inquiry_comparison_snapshots s ON s.inquiry_id = i.inquiry_id
      WHERE i.inquiry_id = $1 AND i.tenant_id = $2`,
    [inquiryId, T],
  )
  return row ?? null
}

/**
 * Per-supplier response coverage for an inquiry: how much of it each supplier
 * actually quoted.
 */
export async function getResponseCoverage(inquiryId: string): Promise<
  Array<{
    supplier_name: string | null
    response_id: string
    source_label: string | null
    total_inquiry_items: number
    responded_items: number
    missing_items: number
    coverage_pct: number
  }>
> {
  return xpartQuery(
    `WITH tot AS (SELECT count(*)::int AS n FROM inquiry_items WHERE inquiry_id = $1)
     SELECT s.name AS supplier_name, r.response_id, r.source_label,
            tot.n AS total_inquiry_items,
            count(sri.response_item_id) FILTER (WHERE sri.inquiry_item_id IS NOT NULL)::int AS responded_items,
            (tot.n - count(sri.response_item_id) FILTER (WHERE sri.inquiry_item_id IS NOT NULL))::int AS missing_items,
            round(100.0 * count(sri.response_item_id) FILTER (WHERE sri.inquiry_item_id IS NOT NULL)
                  / NULLIF(tot.n, 0))::int AS coverage_pct
       FROM supplier_responses r
       CROSS JOIN tot
       JOIN suppliers s ON s.supplier_id = r.supplier_id
       LEFT JOIN supplier_response_items sri ON sri.response_id = r.response_id
      WHERE r.inquiry_id = $1 AND r.is_latest
      GROUP BY s.name, r.response_id, r.source_label, tot.n
      ORDER BY coverage_pct DESC`,
    [inquiryId],
  )
}

/**
 * The comparison grid, read straight out of Xpart's pre-baked snapshot.
 *
 * Not recomputed. Xpart builds this payload in TypeScript after the SQL — it
 * elects best price / best margin per line, folds in supplier ratings, and fills
 * missing retail prices from Finansit. Reproducing that here would be a large
 * amount of work to arrive at a slightly different answer than the screen the
 * buyers actually use, which is the worst of both.
 *
 * The payload is Xpart's internal type, not a contract, so callers should treat
 * every field as optional.
 */
export async function getComparisonSnapshot(
  inquiryId: string,
): Promise<{ payload: unknown; status: string; computed_at: string } | null> {
  const [row] = await xpartQuery<{ payload: unknown; status: string; computed_at: string }>(
    `SELECT payload, status, computed_at
       FROM inquiry_comparison_snapshots
      WHERE inquiry_id = $1 AND tenant_id = $2`,
    [inquiryId, T],
  )
  return row ?? null
}

export interface XpartDescription {
  part_number: string
  brand_code: string | null
  source: string
  language: string
  is_primary: boolean
  description: string
}

/**
 * Every description Xpart holds for these part numbers.
 *
 * Note what `source` is and is not. It is the import CHANNEL — price_list,
 * finansit, supplier_response, shipment_import — not the supplier. The table is
 * unique on (item_id, tenant_id, source, language), so all of ARG's, AUTOMOTOR's
 * and Lubinski's price-list wording collapses into one 'price_list' row and the
 * last import wins. There is no per-supplier naming in Xpart to read, and
 * raw_imports keeps only a 50-row sample of each file, so it cannot be
 * recovered either. What this gives is every distinct name the part goes by,
 * attributed to the pipeline that supplied it — which is the honest version of
 * the question.
 */
export async function getItemDescriptions(partNumbers: string[]): Promise<XpartDescription[]> {
  const codes = [...new Set(partNumbers.map(c => String(c || '').trim()).filter(Boolean))]
  if (codes.length === 0) return []
  return xpartQuery<XpartDescription>(
    `SELECT i.part_number, b.code AS brand_code, d.source, d.language,
            COALESCE(d.is_primary, false) AS is_primary, d.description
       FROM items i
       JOIN item_descriptions d ON d.item_id = i.item_id
       LEFT JOIN brands b ON b.brand_id = i.brand_id
      WHERE i.part_number = ANY($1::text[])
        AND (d.tenant_id IS NULL OR d.tenant_id = $2)
      ORDER BY i.part_number, d.source, d.language`,
    [codes, T],
  )
}

export interface XpartInvoice {
  invoice_id: string
  invoice_number: string
  supplier_invoice_number: string | null
  supplier_name: string | null
  invoice_date: string | null
  due_date: string | null
  currency: string | null
  total_amount: number | null
  amount_paid: number | null
  payment_status: string | null
  reconciliation_status: string | null
  item_count: number
}

/**
 * Supplier invoices Xpart has recorded.
 *
 * supplier_invoice_number is not a column: Xpart writes it into the free-text
 * notes as "Supplier Invoice: X" and parses it back out in JS. Same regex here,
 * in SQL, so the screen shows the same value.
 */
export async function listInvoices(): Promise<XpartInvoice[]> {
  return xpartQuery<XpartInvoice>(
    `SELECT inv.invoice_id, inv.invoice_number,
            btrim(substring(inv.notes from '^Supplier Invoice: (.*)$'), E' \t\r\n') AS supplier_invoice_number,
            s.name AS supplier_name, inv.invoice_date, inv.due_date, inv.currency,
            inv.total_amount::float8 AS total_amount, inv.amount_paid::float8 AS amount_paid,
            inv.payment_status, inv.reconciliation_status,
            (SELECT count(*)::int FROM invoice_items ii WHERE ii.invoice_id = inv.invoice_id) AS item_count
       FROM invoices inv
       LEFT JOIN suppliers s ON s.supplier_id = inv.supplier_id
      WHERE inv.tenant_id = $1
      ORDER BY inv.invoice_date DESC NULLS LAST, inv.created_at DESC`,
    [T],
  )
}

export interface XpartSupplierContext {
  supplier_id: string
  code: string
  name: string
  supplier_role: string | null
  currency: string | null
  default_price_term: string | null
  finansit_code: string | null
  open_orders: number
  open_items: number
  open_value_by_currency: Record<string, number>
  last_order_date: string | null
  price_lists: Array<{
    price_list_id: string
    name: string
    status: string
    currency: string
    total_items: number | null
    effective_date: string | null
  }>
}

/**
 * Everything Xpart knows about one supplier, addressed by its ERP code.
 *
 * The join between the two systems is suppliers.finansit_code — the same value
 * the dashboard uses as supplier_profiles.supplier_code. Three of Xpart's
 * eleven suppliers have no ERP account (Lubinski, ORLYD, SOEX) and simply do
 * not resolve, which is a null rather than an error.
 */
export async function getSupplierContext(finansitCode: string): Promise<XpartSupplierContext | null> {
  const [supplier] = await xpartQuery<{
    supplier_id: string
    code: string
    name: string
    supplier_role: string | null
    currency: string | null
    default_price_term: string | null
    finansit_code: string | null
  }>(
    `SELECT supplier_id, code, name, supplier_role, currency, default_price_term, finansit_code
       FROM suppliers
      WHERE tenant_id = $1 AND btrim(finansit_code) = btrim($2) AND is_active
      LIMIT 1`,
    [T, finansitCode],
  )
  if (!supplier) return null

  const [orders, lists] = await Promise.all([
    xpartQuery<{ currency: string | null; n: string; items: string; value: number; last_date: string | null }>(
      `SELECT currency, count(*)::text AS n, COALESCE(sum(total_items),0)::text AS items,
              COALESCE(sum(total_value),0)::float8 AS value, max(order_date)::text AS last_date
         FROM orders
        WHERE tenant_id = $1 AND supplier_id = $2 AND status = 'submitted'
        GROUP BY currency`,
      [T, supplier.supplier_id],
    ),
    xpartQuery<{
      price_list_id: string
      name: string
      status: string
      currency: string
      total_items: number | null
      effective_date: string | null
    }>(
      `SELECT price_list_id, btrim(name, E' \t\r\n') AS name, status, currency, total_items, effective_date
         FROM supplier_price_lists
        WHERE tenant_id = $1 AND supplier_id = $2 AND status IN ('active','archived')
        ORDER BY effective_date DESC NULLS LAST
        LIMIT 12`,
      [T, supplier.supplier_id],
    ),
  ])

  const byCurrency: Record<string, number> = {}
  let openOrders = 0
  let openItems = 0
  let lastOrderDate: string | null = null
  for (const o of orders) {
    openOrders += Number(o.n)
    openItems += Number(o.items)
    byCurrency[o.currency ?? '—'] = (byCurrency[o.currency ?? '—'] ?? 0) + Number(o.value)
    if (o.last_date && (!lastOrderDate || o.last_date > lastOrderDate)) lastOrderDate = o.last_date
  }

  return {
    ...supplier,
    open_orders: openOrders,
    open_items: openItems,
    open_value_by_currency: byCurrency,
    last_order_date: lastOrderDate,
    price_lists: lists,
  }
}

/**
 * Xpart purchase orders that could correspond to a warehouse shipment.
 *
 * The two systems have no shared key — a scanned carton carries no order number
 * — so this is a candidate list, not a match: the supplier's orders placed
 * before the goods showed up, newest first. Naming it "likely" rather than
 * "the" order is the point; guessing wrong here would attach a scan to the
 * wrong PO, and the screen lets a human pick.
 */
export async function getCandidateOrdersForShipment(
  finansitCode: string,
  arrivedOn: string | null,
): Promise<OpenOrder[]> {
  return xpartQuery<OpenOrder>(
    `SELECT o.order_id, o.order_number,
            s.name AS supplier_name, s.finansit_code AS supplier_finansit_code,
            o.status, o.order_date, o.expected_delivery,
            o.finansit_doc_number, o.finansit_doc_format,
            o.total_items, o.total_value::float8 AS total_value, o.currency,
            i.inquiry_number,
            (CURRENT_DATE - o.order_date::date) AS days_open
       FROM orders o
       JOIN suppliers s ON s.supplier_id = o.supplier_id
       LEFT JOIN inquiries i ON i.inquiry_id = o.inquiry_id
      WHERE o.tenant_id = $1
        AND btrim(s.finansit_code) = btrim($2)
        AND ($3::date IS NULL OR o.order_date::date <= $3::date)
      ORDER BY o.order_date DESC NULLS LAST
      LIMIT 8`,
    [T, finansitCode, arrivedOn],
  )
}
