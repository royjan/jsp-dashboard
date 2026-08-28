import { NextResponse } from 'next/server'
import { readQueryAsync } from '@/lib/neon-read'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems, getCanonicalizer, foldByChain } from '@/lib/services/analytics-service'

export const dynamic = 'force-dynamic'

// Failures here render as zeros rather than errors, so a broken query looks
// exactly like "no data". Collect them and surface them in the response —
// three queries were failing before anyone noticed the empty cards.
// Reset per request below; this route is cached and effectively serial, so the
// worst case for overlapping requests is a duplicated diagnostic string.
let queryFailures: string[] = []

async function safeQuery(sql: string, params?: any[]): Promise<any[]> {
  try {
    return (await readQueryAsync(sql, params)).rows
  } catch (e: any) {
    const msg = e?.message?.substring(0, 160) || 'unknown error'
    console.error('[business-report] Query failed:', msg, '\n  SQL:', sql.trim().split('\n')[0])
    queryFailures.push(msg)
    return []
  }
}

async function safeQueryOne(sql: string, params?: any[]): Promise<any> {
  const rows = await safeQuery(sql, params)
  return rows[0] || null
}

export async function GET() {
  try {
    queryFailures = []
    await initializeSecrets() // FINAPI creds for getItems() (dead-stock source)

    // Revenue on this page and revenue on /brief used to come from two different
    // tables on two different VAT bases, and disagreed about whether the year was
    // up or down. They now share one source: `dashboard.daily_sales`, gross of
    // VAT, one row per calendar day.
    //
    // What `documents` cannot be for this: it archives each invoice once per
    // Btrieve fiscal-year database it was read from, so every one of 2025's
    // 20,273 invoices ALSO sits under year=2026. Grouping by that `year` column
    // reported 2026 at 16.3M — 12.3M of it 2025's revenue — against a 15.1M
    // "2025", a fabricated +8% on a year that was actually flat. On top of that
    // the half-loaded 2026 archive has grand_total = 0 on 2,099 of its 7,147
    // rows, so it cannot even be read on a gross basis.
    //
    // `documents` is still the right source for credit notes below: daily_sales
    // only carries format 11.

    // 1. Revenue by year
    const revenueByYear = await safeQuery(`
      WITH rev AS (
        SELECT EXTRACT(YEAR FROM date)::int as year,
               SUM(revenue) as revenue, SUM(invoice_count) as invoice_count
        FROM daily_sales
        GROUP BY 1
      ), cred AS (
        -- Credit notes are stored signed (negative). The chart draws them as a
        -- magnitude beside revenue and credit_pct is a ratio, so both want the
        -- absolute value; the signed figure rendered as a bar below the axis and
        -- as a negative "credit rate".
        SELECT EXTRACT(YEAR FROM doc_date)::int as year,
               ABS(SUM(total)) as credit_total, COUNT(*) as credit_count
        FROM (
          SELECT DISTINCT ON (doc_number) doc_date, total
          FROM documents
          WHERE format = '12' AND doc_date IS NOT NULL
          ORDER BY doc_number, year DESC
        ) x
        GROUP BY 1
      )
      SELECT r.year, r.revenue, r.invoice_count,
             COALESCE(c.credit_total, 0) as credit_total,
             COALESCE(c.credit_count, 0) as credit_count
      FROM rev r
      LEFT JOIN cred c ON c.year = r.year
      ORDER BY r.year
    `)

    // How far the shared sales table reaches, so a partial year can say so
    // rather than being drawn beside complete ones.
    const revenueDataThrough = await safeQueryOne(`SELECT MAX(date) as d FROM daily_sales`)

    // The only honest year-over-year for the year in progress: Jan 1 → the last
    // day we have, against exactly that window a year earlier. The table above
    // holds whole years, so putting a part-year beside them and subtracting
    // guarantees an invented collapse — which is the mirror image of the invented
    // +8% this page used to show.
    const ytd = await safeQueryOne(`
      WITH bounds AS (
        SELECT MAX(date) AS through FROM daily_sales
      )
      SELECT
        EXTRACT(YEAR FROM b.through)::int AS year,
        b.through AS through,
        COALESCE(SUM(d.revenue) FILTER (
          WHERE d.date >= DATE_TRUNC('year', b.through) AND d.date <= b.through), 0) AS revenue,
        COALESCE(SUM(d.invoice_count) FILTER (
          WHERE d.date >= DATE_TRUNC('year', b.through) AND d.date <= b.through), 0) AS invoice_count,
        COALESCE(SUM(d.revenue) FILTER (
          WHERE d.date >= DATE_TRUNC('year', b.through) - INTERVAL '1 year'
            AND d.date <= b.through - INTERVAL '1 year'), 0) AS prev_revenue,
        COALESCE(SUM(d.invoice_count) FILTER (
          WHERE d.date >= DATE_TRUNC('year', b.through) - INTERVAL '1 year'
            AND d.date <= b.through - INTERVAL '1 year'), 0) AS prev_invoice_count
      FROM daily_sales d CROSS JOIN bounds b
      GROUP BY b.through
    `)

    // 2. Monthly revenue
    const monthlyRevenue = await safeQuery(`
      SELECT
        EXTRACT(YEAR FROM date)::int as year,
        EXTRACT(MONTH FROM date)::int as month,
        SUM(revenue) as revenue,
        SUM(invoice_count) as invoice_count
      FROM daily_sales
      WHERE date >= '2020-01-01'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `)

    // 3. Credit notes analysis by year.
    // Deduped on doc_number (verified globally unique per format: 158,361 distinct
    // across 188,720 format-11 rows) and bucketed on doc_date, never on `year`.
    // Both sides stay on the net `total` basis — this feeds a ratio, and the
    // archive's grand_total is unreliable for the current year.
    const creditsByYear = await safeQuery(`
      WITH inv AS (
        SELECT DISTINCT ON (format, doc_number) format, doc_date, total
        FROM documents
        WHERE format IN ('11', '12') AND doc_date IS NOT NULL
        ORDER BY format, doc_number, year DESC
      )
      SELECT
        EXTRACT(YEAR FROM doc_date)::int as year,
        SUM(CASE WHEN format = '11' THEN 1 ELSE 0 END) as invoice_count,
        SUM(CASE WHEN format = '12' THEN 1 ELSE 0 END) as credit_count,
        SUM(CASE WHEN format = '11' THEN total ELSE 0 END) as invoice_total,
        ABS(SUM(CASE WHEN format = '12' THEN total ELSE 0 END)) as credit_total
      FROM inv
      GROUP BY EXTRACT(YEAR FROM doc_date)::int
      ORDER BY 1
    `)

    // 4. Day of week analysis (Sun-Fri Israeli work week)
    // EXTRACT(DOW) matches strftime('%w'): 0 = Sunday … 6 = Saturday.
    const sunToWed = await safeQuery(`
      SELECT
        CASE EXTRACT(DOW FROM date)::int
          WHEN 0 THEN 'Sunday'
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
        END as day_name,
        EXTRACT(DOW FROM date)::int as day_num,
        AVG(revenue) as avg_revenue,
        AVG(invoice_count) as avg_invoices,
        COUNT(*) as total_days
      FROM daily_sales
      WHERE revenue > 0
        AND EXTRACT(DOW FROM date)::int BETWEEN 0 AND 3
      GROUP BY EXTRACT(DOW FROM date)::int
      ORDER BY EXTRACT(DOW FROM date)::int
    `)

    const endOfWeek = await safeQueryOne(`
      SELECT
        ROUND(AVG(week_total)) as avg_week_end_total,
        ROUND(AVG(week_invoices)) as avg_week_end_invoices,
        COUNT(*) as num_weeks
      FROM (
        SELECT
          TO_CHAR(date, 'IYYY-IW') as yw,
          SUM(revenue) as week_total,
          SUM(invoice_count) as week_invoices
        FROM daily_sales
        WHERE EXTRACT(DOW FROM date)::int IN (4, 5, 6)
          AND revenue > 0
        GROUP BY TO_CHAR(date, 'IYYY-IW')
      ) w
    `)

    const thuFriAvgPerDay = (endOfWeek?.avg_week_end_total || 0) / 2
    const thuFriInvPerDay = (endOfWeek?.avg_week_end_invoices || 0) / 2

    const dayOfWeek = [
      ...sunToWed,
      { day_name: 'Thursday', day_num: 4, avg_revenue: Math.round(thuFriAvgPerDay * 1.15), avg_invoices: Math.round(thuFriInvPerDay * 1.15), total_days: endOfWeek?.num_weeks || 0 },
      { day_name: 'Friday', day_num: 5, avg_revenue: Math.round(thuFriAvgPerDay * 0.85), avg_invoices: Math.round(thuFriInvPerDay * 0.85), total_days: endOfWeek?.num_weeks || 0 },
    ]

    // 5 + 6. Dead stock — sourced from the live FINAPI catalog (getItems), which
    // carries real current stock, prices (zero-price items enriched via FINAPI
    // batch) and 4 years of per-item sales. The old item_snapshot/SQLite source
    // was empty in prod and had no cost/multi-year columns. "3+ years" = no sales
    // this year, last year, or 2 years ago (matches the original definition).
    let deadStockSummary: any = null
    let topDeadStock: any[] = []
    try {
      const allItems = await getItems()
      const stocked = allItems.filter((it) => (it.stock_qty || 0) > 0)
      const val = (it: any) => (it.stock_qty || 0) * (it.price || 0)
      const noCur = (it: any) => (it.sold_this_year || 0) === 0
      const no2y = (it: any) => noCur(it) && (it.sold_last_year || 0) === 0
      const no3y = (it: any) => no2y(it) && (it.sold_2y_ago || 0) === 0

      deadStockSummary = {
        total_items_with_stock: stocked.length,
        total_inventory_value: stocked.reduce((s, it) => s + val(it), 0),
        no_sales_this_year: stocked.filter(noCur).reduce((s, it) => s + val(it), 0),
        no_sales_2y: stocked.filter(no2y).reduce((s, it) => s + val(it), 0),
        no_sales_3y: stocked.filter(no3y).reduce((s, it) => s + val(it), 0),
        items_no_sales_this_year: stocked.filter(noCur).length,
        items_no_sales_2y: stocked.filter(no2y).length,
        items_no_sales_3y: stocked.filter(no3y).length,
      }

      topDeadStock = stocked
        .filter(no3y)
        .map((it: any) => ({
          item_code: it.code,
          // The codes folded into this row. getItems() already merges a chain's stock
          // and sales, so a merged row is indistinguishable from a plain one unless it
          // says so — and the reader who goes looking for the old code in the ERP needs
          // to know which numbers this line is the sum of.
          alias_codes: it.alias_codes || [],
          item_name: it.name,
          qty: it.stock_qty || 0,
          retail_price: it.price || 0,
          capital_tied: val(it),
          sold_this_year: it.sold_this_year || 0,
          sold_last_year: it.sold_last_year || 0,
          sold_2y_ago: it.sold_2y_ago || 0,
          sold_3y_ago: it.sold_3y_ago || 0,
        }))
        .sort((a, b) => b.capital_tied - a.capital_tied)
        .slice(0, 50)
    } catch (e: any) {
      console.warn('[business-report] dead stock (getItems) failed:', e?.message?.substring(0, 120))
    }

    // 7. Customer retention analysis
    const customerRetention = await safeQuery(`
      SELECT
        year,
        COUNT(DISTINCT customer_code) as total_customers,
        SUM(total_revenue) as total_revenue
      FROM customer_stats
      WHERE total_revenue > 0
      GROUP BY year
      ORDER BY year
    `)

    // 8. Customer concentration per year
    const customerConcentration = await safeQuery(`
      SELECT
        year,
        customer_code,
        customer_name,
        total_revenue
      FROM customer_stats
      WHERE total_revenue > 0
      ORDER BY year, total_revenue DESC
    `)

    // Build concentration data per year
    const concentrationByYear: Record<string, any> = {}
    for (const row of customerConcentration) {
      if (!concentrationByYear[row.year]) {
        concentrationByYear[row.year] = { customers: [], totalRevenue: 0 }
      }
      // total_revenue is NUMERIC, which node-postgres hands back as a string.
      // Coerce here, at the one place rows enter, or every `+` below concatenates
      // instead of adding: totalRevenue became a 3000-char string and the top-N
      // percentages divided by it to 0.
      const revenue = Number(row.total_revenue) || 0
      concentrationByYear[row.year].customers.push({ ...row, total_revenue: revenue })
      concentrationByYear[row.year].totalRevenue += revenue
    }

    const concentration = Object.entries(concentrationByYear).map(([year, data]: [string, any]) => {
      const top5Revenue = data.customers.slice(0, 5).reduce((s: number, c: any) => s + c.total_revenue, 0)
      const top10Revenue = data.customers.slice(0, 10).reduce((s: number, c: any) => s + c.total_revenue, 0)
      return {
        year: parseInt(year),
        total_customers: data.customers.length,
        total_revenue: data.totalRevenue,
        top5_pct: data.totalRevenue > 0 ? Math.round(top5Revenue / data.totalRevenue * 1000) / 10 : 0,
        top10_pct: data.totalRevenue > 0 ? Math.round(top10Revenue / data.totalRevenue * 1000) / 10 : 0,
        top5_revenue: top5Revenue,
      }
    }).sort((a, b) => a.year - b.year)

    // 9. New vs returning customers per year
    const allCustomerYears = await safeQuery(`
      SELECT customer_code, MIN(year) as first_year
      FROM customer_stats
      WHERE total_revenue > 0
      GROUP BY customer_code
    `)

    const firstYearMap = new Map<string, number>()
    for (const r of allCustomerYears) {
      firstYearMap.set(r.customer_code, r.first_year)
    }

    const retentionDetails = customerRetention.map(yr => {
      const yearCustomers = customerConcentration.filter(c => c.year === yr.year && c.total_revenue > 0)
      const newCustomers = yearCustomers.filter(c => firstYearMap.get(c.customer_code) === yr.year).length
      const returning = yearCustomers.length - newCustomers
      return {
        year: yr.year,
        // COUNT() is bigint and SUM() over NUMERIC is numeric — both arrive as
        // strings. The report page sorts on these columns, and a string sort
        // orders "1000" before "425".
        total_customers: Number(yr.total_customers) || 0,
        new_customers: newCustomers,
        returning_customers: returning,
        total_revenue: Number(yr.total_revenue) || 0,
        retention_pct: yr.year === customerRetention[0]?.year ? null :
          Math.round(returning / (customerRetention.find(r => r.year === yr.year - 1)?.total_customers || 1) * 1000) / 10,
      }
    })

    // 10-11. Overstock and open orders.
    //
    // These used to query an `item_snapshot` table that doesn't exist here —
    // the synced table is `dashboard.item_snapshots` and it carries neither
    // ordered_qty/incoming_qty nor sold_2y_ago, so both cards reported zeros.
    // The live enriched item cache (already loaded above for the dead-stock
    // summary) has every field, so derive them from it.
    let overstockItems = { overstock_count: 0, overstock_value: 0 }
    let openOrders = { items_ordered: 0, total_ordered: 0, items_incoming: 0, total_incoming: 0 }
    try {
      const allItems = await getItems()
      const sold3y = (it: any) =>
        (it.sold_this_year || 0) + (it.sold_last_year || 0) + (it.sold_2y_ago || 0)
      const overstocked = allItems.filter(
        (it: any) => (it.stock_qty || 0) > 0 && sold3y(it) > 0 && (it.stock_qty || 0) > sold3y(it) * 3,
      )
      overstockItems = {
        overstock_count: overstocked.length,
        overstock_value: overstocked.reduce((s: number, it: any) => s + (it.stock_qty || 0) * (it.price || 0), 0),
      }
      openOrders = allItems.reduce(
        (acc: any, it: any) => {
          const ordered = Number(it.ordered_qty) || 0
          const incoming = Number(it.incoming_qty) || 0
          if (ordered > 0) { acc.items_ordered++; acc.total_ordered += ordered }
          if (incoming > 0) { acc.items_incoming++; acc.total_incoming += incoming }
          return acc
        },
        { items_ordered: 0, total_ordered: 0, items_incoming: 0, total_incoming: 0 },
      )
    } catch (e: any) {
      console.warn('[business-report] overstock/open-orders from items cache failed:', e?.message)
    }

    // 12. ABC summary from monthly sales
    // MAX(item_name) rather than selecting it bare: Postgres rejects a column
    // that is neither grouped nor aggregated (SQLite allowed it), which made
    // this query fail silently and report zero items in every ABC class.
    const abcData = await safeQuery(`
      SELECT
        item_code,
        MAX(item_name) as item_name,
        SUM(revenue) as total_revenue
      FROM monthly_sales
      WHERE year >= 2024
      GROUP BY item_code
      HAVING SUM(revenue) > 0
      ORDER BY SUM(revenue) DESC
    `)

    // node-postgres returns NUMERIC as a string, so these must be coerced —
    // otherwise `+` concatenates, every cumulative share stays <= 0.8 and the
    // whole catalogue is classified as A with a nonsense revenue figure.
    // FOLD THE CHAIN BEFORE CLASSIFYING. `monthly_sales` is keyed by the code that
    // was on the document, so a superseded part ranks as two items with a share
    // each — measured 2026-08-22: 4,300 ranked rows over 4,252 real parts, 47 of
    // them split. Both halves then sit lower in the cumulative curve than the part
    // belongs, which is exactly what ABC is supposed to decide.
    const abcCanon = await getCanonicalizer().catch(() => (c: string) => c)
    const abcRows = foldByChain(
      abcData.map((r: any) => ({ ...r, total_revenue: Number(r.total_revenue) || 0 })),
      abcCanon,
      { codeField: 'item_code', sum: ['total_revenue'], longest: ['item_name'] },
    ).sort((a: any, b: any) => b.total_revenue - a.total_revenue)
    const totalABCRevenue = abcRows.reduce((s: number, r: any) => s + r.total_revenue, 0)
    let cumulative = 0
    let classACount = 0, classBCount = 0, classCCount = 0
    let classARevenue = 0, classBRevenue = 0, classCRevenue = 0
    for (const item of abcRows) {
      cumulative += item.total_revenue
      const pct = totalABCRevenue > 0 ? cumulative / totalABCRevenue : 0
      if (pct <= 0.8) { classACount++; classARevenue += item.total_revenue }
      else if (pct <= 0.95) { classBCount++; classBRevenue += item.total_revenue }
      else { classCCount++; classCRevenue += item.total_revenue }
    }

    // 13. Monthly average across years for seasonality
    const seasonality = await safeQuery(`
      SELECT
        month,
        AVG(revenue) as avg_revenue,
        AVG(invoice_count) as avg_invoices
      FROM (
        SELECT
          EXTRACT(MONTH FROM date)::int as month,
          EXTRACT(YEAR FROM date)::int as year,
          SUM(revenue) as revenue,
          SUM(invoice_count) as invoice_count
        FROM daily_sales
        WHERE date >= '2020-01-01' AND date < DATE_TRUNC('year', CURRENT_DATE)
        GROUP BY EXTRACT(YEAR FROM date)::int, EXTRACT(MONTH FROM date)::int
      ) m
      GROUP BY month
      ORDER BY month
    `)

    // 14. Average invoice value per year
    const avgInvoiceValue = revenueByYear.map((r: any) => ({
      year: r.year,
      avg_value: r.invoice_count > 0 ? Math.round(r.revenue / r.invoice_count) : 0,
    }))

    // 15. KPIs summary
    // COUNT(DISTINCT item_code) counts CODES; a part that was re-coded counts twice.
    // The ABC fold above already resolved every code in this same window to its
    // chain, so the number of parts is the number of folded rows — 4,252 against
    // the 4,300 this used to report.
    const activeItems = { count: abcRows.length }

    // Same missing `item_snapshot` table as above — the dead-stock summary
    // already counted stocked items from the live cache, so reuse that rather
    // than reporting 0 next to a 45M inventory value.
    const totalItemsWithStock = { count: deadStockSummary?.total_items_with_stock || 0 }

    // The newest year in the table is always partial — the archive currently ends
    // mid-May 2026 — so `revenue / 12` and `revenue / inventory` both read as a
    // collapse that is really just a short year. Scale by the span actually
    // covered instead, and hand the coverage to the client so it can say so.
    const latestYearRow = revenueByYear.length > 0
      ? revenueByYear.reduce((a: any, b: any) => (b.year > a.year ? b : a))
      : null
    const latestYearRevenue = latestYearRow?.revenue || 0
    const latestYear = latestYearRow?.year ?? new Date().getFullYear()

    const revenueThrough: string | null = revenueDataThrough?.d
      ? new Date(revenueDataThrough.d).toISOString().split('T')[0]
      : null

    // Days of `latestYear` the archive actually covers. A closed year covers all
    // of itself; only the newest one is short.
    const latestYearDays = (() => {
      if (!revenueThrough) return 365
      const through = new Date(`${revenueThrough}T00:00:00Z`)
      if (through.getUTCFullYear() !== latestYear) return 365
      const jan1 = Date.UTC(latestYear, 0, 1)
      return Math.max(1, Math.round((through.getTime() - jan1) / 86400000) + 1)
    })()
    const latestYearIsPartial = latestYearDays < 365
    const annualizedLatestRevenue = latestYearRevenue * (365 / latestYearDays)

    const inventoryValue = deadStockSummary?.total_inventory_value || 1
    const turnoverRatio = Math.round(annualizedLatestRevenue / inventoryValue * 100) / 100

    return NextResponse.json({
      // Non-empty when a query failed and its section is showing zeros.
      query_failures: queryFailures.length ? queryFailures : undefined,
      revenue_by_year: revenueByYear,
      monthly_revenue: monthlyRevenue,
      credits_by_year: creditsByYear,
      day_of_week: dayOfWeek,
      dead_stock_summary: deadStockSummary || {
        total_items_with_stock: 0, total_inventory_value: 0,
        no_sales_this_year: 0, no_sales_2y: 0, no_sales_3y: 0,
        items_no_sales_this_year: 0, items_no_sales_2y: 0, items_no_sales_3y: 0,
      },
      top_dead_stock: topDeadStock,
      customer_retention: retentionDetails,
      customer_concentration: concentration,
      overstock: overstockItems || { overstock_count: 0, overstock_value: 0 },
      open_orders: openOrders || { items_ordered: 0, total_ordered: 0, items_incoming: 0, total_incoming: 0 },
      abc_summary: {
        classA: { count: classACount, revenue: classARevenue },
        classB: { count: classBCount, revenue: classBRevenue },
        classC: { count: classCCount, revenue: classCRevenue },
        // The FOLDED count, matching the three class counts beside it. `abcData.length`
        // is raw codes, so the header said 4,300 over classes that summed to 4,234 —
        // the same off-by-a-chain the class counts were just fixed for.
        total_items: abcRows.length,
        total_revenue: totalABCRevenue,
      },
      seasonality,
      avg_invoice_value: avgInvoiceValue,
      // How far the deduped document archive actually reaches, so the client can
      // label a partial year instead of drawing it beside complete ones.
      revenue_data_through: revenueThrough,
      revenue_latest_year: latestYear,
      revenue_latest_year_partial: latestYearIsPartial,
      // Year-to-date against the same window last year — the comparison the
      // yearly table cannot make for the year still in progress.
      revenue_ytd: ytd
        ? {
            year: ytd.year,
            through: new Date(ytd.through).toISOString().split('T')[0],
            revenue: Number(ytd.revenue),
            invoice_count: Number(ytd.invoice_count),
            prev_revenue: Number(ytd.prev_revenue),
            prev_invoice_count: Number(ytd.prev_invoice_count),
            change: Number(ytd.prev_revenue) > 0
              ? Math.round(((Number(ytd.revenue) - Number(ytd.prev_revenue)) / Number(ytd.prev_revenue)) * 1000) / 10
              : null,
          }
        : null,
      kpis: {
        monthly_revenue: latestYearRevenue / (latestYearDays / 30.44),
        turnover_ratio: turnoverRatio,
        dead_stock_pct_3y: deadStockSummary?.total_inventory_value > 0
          ? Math.round(deadStockSummary.no_sales_3y / deadStockSummary.total_inventory_value * 1000) / 10
          : 0,
        credit_pct: creditsByYear.length > 0
          ? Math.round(creditsByYear[creditsByYear.length - 1].credit_count / (creditsByYear[creditsByYear.length - 1].invoice_count || 1) * 1000) / 10
          : 0,
        active_items: activeItems?.count || 0,
        items_with_stock: totalItemsWithStock?.count || 0,
        inventory_value: inventoryValue,
      },
    })
  } catch (error: any) {
    console.error('[business-report]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
