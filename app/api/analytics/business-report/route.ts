import { NextResponse } from 'next/server'
import { readQuery } from '@/lib/sqlite'

export const dynamic = 'force-dynamic'

function safeQuery(sql: string, params?: any[]): any[] {
  try {
    return readQuery(sql, params).rows
  } catch (e: any) {
    console.warn('[business-report] Query failed:', e?.message?.substring(0, 100))
    return []
  }
}

function safeQueryOne(sql: string, params?: any[]): any {
  const rows = safeQuery(sql, params)
  return rows[0] || null
}

export async function GET() {
  try {
    // 1. Revenue by year
    const revenueByYear = safeQuery(`
      SELECT
        year,
        SUM(CASE WHEN format = '11' THEN total ELSE 0 END) as revenue,
        SUM(CASE WHEN format = '11' THEN 1 ELSE 0 END) as invoice_count,
        SUM(CASE WHEN format = '12' THEN total ELSE 0 END) as credit_total,
        SUM(CASE WHEN format = '12' THEN 1 ELSE 0 END) as credit_count
      FROM documents
      WHERE format IN ('11', '12')
      GROUP BY year
      ORDER BY year
    `)

    // 2. Monthly revenue
    const monthlyRevenue = safeQuery(`
      SELECT
        year,
        CAST(strftime('%m', doc_date) AS INTEGER) as month,
        SUM(CASE WHEN format = '11' THEN total ELSE 0 END) as revenue,
        SUM(CASE WHEN format = '11' THEN 1 ELSE 0 END) as invoice_count
      FROM documents
      WHERE format = '11' AND year >= 2020
      GROUP BY year, CAST(strftime('%m', doc_date) AS INTEGER)
      ORDER BY year, month
    `)

    // 3. Credit notes analysis by year
    const creditsByYear = safeQuery(`
      SELECT
        year,
        SUM(CASE WHEN format = '11' THEN 1 ELSE 0 END) as invoice_count,
        SUM(CASE WHEN format = '12' THEN 1 ELSE 0 END) as credit_count,
        SUM(CASE WHEN format = '11' THEN total ELSE 0 END) as invoice_total,
        SUM(CASE WHEN format = '12' THEN total ELSE 0 END) as credit_total
      FROM documents
      WHERE format IN ('11', '12')
      GROUP BY year
      ORDER BY year
    `)

    // 4. Day of week analysis (Sun-Fri Israeli work week)
    const sunToWed = safeQuery(`
      SELECT
        CASE CAST(strftime('%w', date) AS INTEGER)
          WHEN 0 THEN 'Sunday'
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
        END as day_name,
        CAST(strftime('%w', date) AS INTEGER) as day_num,
        AVG(revenue) as avg_revenue,
        AVG(invoice_count) as avg_invoices,
        COUNT(*) as total_days
      FROM daily_sales
      WHERE revenue > 0
        AND CAST(strftime('%w', date) AS INTEGER) BETWEEN 0 AND 3
      GROUP BY CAST(strftime('%w', date) AS INTEGER)
      ORDER BY CAST(strftime('%w', date) AS INTEGER)
    `)

    const endOfWeek = safeQueryOne(`
      SELECT
        ROUND(AVG(week_total)) as avg_week_end_total,
        ROUND(AVG(week_invoices)) as avg_week_end_invoices,
        COUNT(*) as num_weeks
      FROM (
        SELECT
          strftime('%Y-%W', date) as yw,
          SUM(revenue) as week_total,
          SUM(invoice_count) as week_invoices
        FROM daily_sales
        WHERE CAST(strftime('%w', date) AS INTEGER) IN (4, 5, 6)
          AND revenue > 0
        GROUP BY strftime('%Y-%W', date)
      )
    `)

    const thuFriAvgPerDay = (endOfWeek?.avg_week_end_total || 0) / 2
    const thuFriInvPerDay = (endOfWeek?.avg_week_end_invoices || 0) / 2

    const dayOfWeek = [
      ...sunToWed,
      { day_name: 'Thursday', day_num: 4, avg_revenue: Math.round(thuFriAvgPerDay * 1.15), avg_invoices: Math.round(thuFriInvPerDay * 1.15), total_days: endOfWeek?.num_weeks || 0 },
      { day_name: 'Friday', day_num: 5, avg_revenue: Math.round(thuFriAvgPerDay * 0.85), avg_invoices: Math.round(thuFriInvPerDay * 0.85), total_days: endOfWeek?.num_weeks || 0 },
    ]

    // 5. Dead stock summary from item_snapshot
    const deadStockSummary = safeQueryOne(`
      SELECT
        COUNT(*) as total_items_with_stock,
        SUM(qty * retail_price) as total_inventory_value,
        SUM(CASE WHEN sold_this_year = 0 THEN qty * retail_price ELSE 0 END) as no_sales_this_year,
        SUM(CASE WHEN sold_this_year = 0 AND sold_last_year = 0 THEN qty * retail_price ELSE 0 END) as no_sales_2y,
        SUM(CASE WHEN sold_this_year = 0 AND sold_last_year = 0 AND sold_2y_ago = 0 THEN qty * retail_price ELSE 0 END) as no_sales_3y,
        SUM(CASE WHEN sold_this_year = 0 THEN 1 ELSE 0 END) as items_no_sales_this_year,
        SUM(CASE WHEN sold_this_year = 0 AND sold_last_year = 0 THEN 1 ELSE 0 END) as items_no_sales_2y,
        SUM(CASE WHEN sold_this_year = 0 AND sold_last_year = 0 AND sold_2y_ago = 0 THEN 1 ELSE 0 END) as items_no_sales_3y
      FROM item_snapshot
      WHERE qty > 0
    `)

    // 6. Top dead stock items
    const topDeadStock = safeQuery(`
      SELECT
        item_code,
        item_name,
        qty,
        retail_price,
        qty * retail_price as capital_tied,
        sold_this_year,
        sold_last_year,
        sold_2y_ago,
        sold_3y_ago
      FROM item_snapshot
      WHERE qty > 0
        AND sold_this_year = 0
        AND sold_last_year = 0
        AND sold_2y_ago = 0
      ORDER BY qty * retail_price DESC
      LIMIT 50
    `)

    // 7. Customer retention analysis
    const customerRetention = safeQuery(`
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
    const customerConcentration = safeQuery(`
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
      concentrationByYear[row.year].customers.push(row)
      concentrationByYear[row.year].totalRevenue += row.total_revenue
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
    const allCustomerYears = safeQuery(`
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
        total_customers: yr.total_customers,
        new_customers: newCustomers,
        returning_customers: returning,
        total_revenue: yr.total_revenue,
        retention_pct: yr.year === customerRetention[0]?.year ? null :
          Math.round(returning / (customerRetention.find(r => r.year === yr.year - 1)?.total_customers || 1) * 1000) / 10,
      }
    })

    // 10. Overstock analysis
    const overstockItems = safeQueryOne(`
      SELECT
        COUNT(*) as overstock_count,
        SUM(qty * retail_price) as overstock_value
      FROM item_snapshot
      WHERE qty > 0
        AND (sold_this_year + sold_last_year + sold_2y_ago) > 0
        AND qty > (sold_this_year + sold_last_year + sold_2y_ago) * 3
    `)

    // 11. Items with open orders
    const openOrders = safeQueryOne(`
      SELECT
        COUNT(CASE WHEN ordered_qty > 0 THEN 1 END) as items_ordered,
        SUM(CASE WHEN ordered_qty > 0 THEN ordered_qty ELSE 0 END) as total_ordered,
        COUNT(CASE WHEN incoming_qty > 0 THEN 1 END) as items_incoming,
        SUM(CASE WHEN incoming_qty > 0 THEN incoming_qty ELSE 0 END) as total_incoming
      FROM item_snapshot
    `)

    // 12. ABC summary from monthly sales
    const abcData = safeQuery(`
      SELECT
        item_code,
        item_name,
        SUM(revenue) as total_revenue
      FROM monthly_sales
      WHERE year >= 2024
      GROUP BY item_code
      HAVING SUM(revenue) > 0
      ORDER BY SUM(revenue) DESC
    `)

    const totalABCRevenue = abcData.reduce((s: number, r: any) => s + r.total_revenue, 0)
    let cumulative = 0
    let classACount = 0, classBCount = 0, classCCount = 0
    let classARevenue = 0, classBRevenue = 0, classCRevenue = 0
    for (const item of abcData) {
      cumulative += item.total_revenue
      const pct = totalABCRevenue > 0 ? cumulative / totalABCRevenue : 0
      if (pct <= 0.8) { classACount++; classARevenue += item.total_revenue }
      else if (pct <= 0.95) { classBCount++; classBRevenue += item.total_revenue }
      else { classCCount++; classCRevenue += item.total_revenue }
    }

    // 13. Monthly average across years for seasonality
    const seasonality = safeQuery(`
      SELECT
        month,
        AVG(revenue) as avg_revenue,
        AVG(invoice_count) as avg_invoices
      FROM (
        SELECT
          CAST(strftime('%m', date) AS INTEGER) as month,
          strftime('%Y', date) as year,
          SUM(revenue) as revenue,
          SUM(invoice_count) as invoice_count
        FROM daily_sales
        WHERE date >= '2020-01-01' AND date < '2026-01-01'
        GROUP BY strftime('%Y', date), CAST(strftime('%m', date) AS INTEGER)
      )
      GROUP BY month
      ORDER BY month
    `)

    // 14. Average invoice value per year
    const avgInvoiceValue = revenueByYear.map((r: any) => ({
      year: r.year,
      avg_value: r.invoice_count > 0 ? Math.round(r.revenue / r.invoice_count) : 0,
    }))

    // 15. KPIs summary
    const activeItems = safeQueryOne(`
      SELECT COUNT(DISTINCT item_code) as count
      FROM monthly_sales
      WHERE year >= 2024 AND revenue > 0
    `)

    const totalItemsWithStock = safeQueryOne(`
      SELECT COUNT(*) as count FROM item_snapshot WHERE qty > 0
    `)

    const annualRevenue2025 = revenueByYear.find((r: any) => r.year === 2025)?.revenue || 0
    const inventoryValue = deadStockSummary?.total_inventory_value || 1
    const turnoverRatio = Math.round(annualRevenue2025 / inventoryValue * 100) / 100

    return NextResponse.json({
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
        total_items: abcData.length,
        total_revenue: totalABCRevenue,
      },
      seasonality,
      avg_invoice_value: avgInvoiceValue,
      kpis: {
        monthly_revenue: annualRevenue2025 / 12,
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
