export const maxDuration = 60

import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems, getCanonicalizer, foldByChain, chainCodesOf } from '@/lib/services/analytics-service'

/**
 * What we actually buy from this supplier, and how fast it sells.
 *
 * The previous version read `dashboard.reorder_queue` (0 rows — the queue is
 * never populated) and then padded the result with the top-50 globally urgent
 * reorder recommendations, which have no connection to the supplier being
 * viewed. So it returned either nothing or another supplier's items.
 *
 * This derives demand from the supplier's own purchase lines instead:
 * everything bought from them, joined to yearly sales for velocity and to the
 * latest item snapshot for stock on hand. `coverMonths` is the honest signal —
 * stock divided by monthly sales — and is null when we have no sales history
 * rather than pretending the item is over-stocked.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await initializeSecrets()
    const { code } = await params

    // Purchase lines for this supplier (61 order / 62 in-transit / 58 invoice),
    // aggregated per item, with sales over the last two calendar years and the
    // most recent stock snapshot we hold for that item.
    const res = await query(
      `WITH bought AS (
         SELECT l.item_code,
                MAX(l.item_name)                    AS item_name,
                SUM(l.quantity)                     AS qty,
                COUNT(DISTINCT d.doc_number)        AS orders,
                MAX(d.doc_date)                     AS last_order,
                SUM(l.line_total)                   AS spend
           FROM dashboard.document_lines l
           JOIN dashboard.documents d
             ON d.doc_number = l.doc_number AND d.format = l.format AND d.year = l.year
          WHERE d.customer_code = $1 AND d.format IN ('61','62','58')
          GROUP BY l.item_code
       ),
       sales AS (
         SELECT item_code, SUM(units_sold) AS units
           FROM dashboard.yearly_item_sales
          WHERE year >= EXTRACT(YEAR FROM CURRENT_DATE) - 1
          GROUP BY item_code
       )
       -- Stock and price used to come from a third CTE over dashboard.item_snapshots.
       -- They cannot: that table stopped being written on 2026-03-21, and its price
       -- column is 0/NULL on every row after 2026-03-15. So "cover months" was computed
       -- from five-month-old stock, and the value of what this supplier's stock ties up
       -- was always zero. Both now come from the live catalogue below.
       SELECT b.item_code, b.item_name, b.qty, b.orders, b.last_order::text AS last_order,
              b.spend, COALESCE(s.units, 0) AS units_sold
         FROM bought b
         LEFT JOIN sales s ON s.item_code = b.item_code
        ORDER BY b.qty DESC
        LIMIT 500`,
      [code],
    )

    const liveByCode = new Map<string, any>()
    for (const it of await getItems()) {
      const c = String(it.code ?? '').toUpperCase()
      if (c) liveByCode.set(c, it)
    }

    // Fold supersession chains before the cut. Purchase orders are written
    // against whatever code was current that day, so without this a supplier's
    // one part shows twice, and the alias half misses `liveByCode` (keyed by
    // canonical code) so it renders with no stock, no price and no cover months.
    // Widened to 500 above so the fold happens before the 200-row cut.
    const canon = await getCanonicalizer()
    const folded = foldByChain(res.rows as Record<string, unknown>[], canon, {
      codeField: 'item_code',
      sum: ['qty', 'orders', 'spend', 'units_sold'],
      max: ['last_order'],
      longest: ['item_name'],
    })
      .sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0))
      .slice(0, 200)

    // Sales for the WHOLE chain, not just the codes this supplier's POs used —
    // a part bought under the old code still sells under the new one.
    const chainCodes = new Set<string>()
    for (const r of folded) {
      const live = liveByCode.get(String(r.item_code || '').toUpperCase())
      for (const c of live ? chainCodesOf(live) : [String(r.item_code)]) chainCodes.add(c)
    }
    const chainSales = new Map<string, number>()
    if (chainCodes.size > 0) {
      const sres = await query(
        `SELECT item_code, SUM(units_sold) AS units
           FROM dashboard.yearly_item_sales
          WHERE year >= EXTRACT(YEAR FROM CURRENT_DATE) - 1
            AND item_code = ANY($1)
          GROUP BY item_code`,
        [[...chainCodes]],
      ).catch(() => null)
      for (const row of (sres?.rows ?? []) as any[]) {
        const k = canon(String(row.item_code || ''))
        chainSales.set(k, (chainSales.get(k) || 0) + (Number(row.units) || 0))
      }
    }

    const items = folded.map((r0: Record<string, unknown>) => {
      const live = liveByCode.get(String(r0.item_code || '').toUpperCase())
      const chainUnits = chainSales.get(String(r0.item_code || ''))
      if (chainUnits != null) r0 = { ...r0, units_sold: chainUnits }
      const r = {
        ...r0,
        stock_qty: live?.stock_qty ?? null,
        price: live?.price ?? null,
      } as Record<string, unknown>
      // Two calendar years of sales → per month.
      const avgMonthlySales = (Number(r.units_sold) || 0) / 24
      const stockQty = r.stock_qty == null ? null : Number(r.stock_qty)
      const coverMonths =
        avgMonthlySales > 0 && stockQty != null
          ? Math.round((stockQty / avgMonthlySales) * 10) / 10
          : null
      return {
        itemCode: String(r.item_code),
        itemName: (r.item_name as string) || String(r.item_code),
        purchasedQty: Number(r.qty) || 0,
        orders: Number(r.orders) || 0,
        lastOrder: (r.last_order as string) || null,
        spend: Number(r.spend) || 0,
        unitsSold: Number(r.units_sold) || 0,
        avgMonthlySales: Math.round(avgMonthlySales * 10) / 10,
        stockQty,
        price: r.price == null ? null : Number(r.price),
        coverMonths,
      }
    })

    // Buying it but not selling it — the actionable end of the list.
    const stale = items.filter((i) => i.unitsSold === 0).length
    const lowCover = items.filter((i) => i.coverMonths != null && i.coverMonths < 1).length

    return NextResponse.json({
      items,
      count: items.length,
      supplierCode: code,
      summary: {
        items: items.length,
        totalSpend: items.reduce((s, i) => s + i.spend, 0),
        noSales: stale,
        lowCover,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', items: [] },
      { status: 500 },
    )
  }
}
