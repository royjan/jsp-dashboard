import { fetchItems, fetchDocuments, fetchDocumentDetail, fetchDashboard, fetchItemDetail, fetchBatchStock, fetchStock } from '../finansit-client'
import { getCached, setCache } from '../redis-client'
import { query as dbQuery } from '../db'
import { CACHE_TTL, DOC_FORMATS, MONTH_NAMES } from '../constants'
import type { DemandItem, SalesDataPoint, SeasonalDataPoint, DeadStockItem, ReorderItem, FinansitItem, DashboardData, TopSellingItem } from '../types'

// ── Dashboard KPIs ──

export async function getDashboardData(): Promise<DashboardData> {
  const cacheKey = 'dashboard:kpis'
  const cached = await getCached<DashboardData>(cacheKey)
  if (cached) return cached

  const data = await fetchDashboard()
  await setCache(cacheKey, data, CACHE_TTL.DASHBOARD)
  return data
}

// ── Items with full enrichment ──

export async function getItems(): Promise<FinansitItem[]> {
  const cacheKey = 'items:enriched:v6'
  const cached = await getCached<FinansitItem[]>(cacheKey)
  if (cached) return cached

  // Discover item codes from invoice + quote line items
  // Process 500 recent invoices and 200 quotes to find actively traded items
  const recentInvoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 500)
  let quotes: any[] = []
  try {
    quotes = await fetchDocuments(DOC_FORMATS.QUOTE, 200)
  } catch (e) {
    console.warn('[Analytics] Quote fetch failed:', e)
  }

  const activeItemCodes = new Set<string>()
  const allDocs = [
    ...recentInvoices.map((d: any) => ({ format: 11, doc_number: d.doc_number })),
    ...quotes.map((d: any) => ({ format: 31, doc_number: d.doc_number })),
  ]

  for (let i = 0; i < allDocs.length; i += 20) {
    const batch = allDocs.slice(i, i + 20)
    const details = await Promise.all(
      batch.map(async (doc) => {
        try { return await fetchDocumentDetail(doc.format, doc.doc_number) } catch { return null }
      })
    )
    for (const detail of details) {
      if (!detail?.lines) continue
      for (const line of detail.lines) {
        if (line.item_code && line.item_code.length > 1) {
          activeItemCodes.add(line.item_code)
        }
      }
    }
  }

  console.log(`[Analytics] Discovered ${activeItemCodes.size} unique items from ${recentInvoices.length} invoices + ${quotes.length} quotes`)

  // Fetch full enriched detail for each item via /api/items/{code}
  // This gives us stock_qty, sold_this_year, sold_last_year, price, etc.
  const codes = [...activeItemCodes]
  const items: FinansitItem[] = []

  for (let i = 0; i < codes.length; i += 20) {
    const batch = codes.slice(i, i + 20)
    const results = await Promise.all(
      batch.map(async (code) => {
        try { return await fetchItemDetail(code) } catch { return null }
      })
    )
    for (const raw of results) {
      if (!raw || !raw.code) continue
      items.push({
        code: raw.code,
        name: raw.name || raw.code,
        english_name: raw.english_name || '',
        barcode: raw.barcode || '',
        group: raw.group || '',
        supplier: raw.supplier || '',
        price: raw.price_list_price || raw.price || 0,
        in_stock: raw.stock_qty || raw.in_stock || 0,
        inquiry_count: raw.inquiry_count || 0,
        stock_qty: raw.stock_qty || 0,
        ordered_qty: raw.ordered_qty || 0,
        incoming_qty: raw.incoming_qty || 0,
        sold_this_year: raw.sold_this_year || 0,
        sold_last_year: raw.sold_last_year || 0,
        sold_2_years_ago: raw.sold_2y_ago || 0,
        sold_3_years_ago: raw.sold_3y_ago || 0,
        place: raw.place || '',
        category: raw.group || undefined,
      })
    }
  }

  console.log(`[Analytics] Enriched ${items.length} items from ${codes.length} active codes`)
  await setCache(cacheKey, items, CACHE_TTL.ITEMS)
  return items
}

// ── Demand Analysis ──

export async function getDemandAnalysis(dateFrom?: string, dateTo?: string): Promise<DemandItem[]> {
  const cacheKey = `analytics:demand:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = await getCached<DemandItem[]>(cacheKey)
  if (cached) return cached

  // Fetch quotes (format 31) via list endpoint
  let allQuotes = await fetchDocuments(DOC_FORMATS.QUOTE, 500)

  // Filter by date range if specified
  const quotes = allQuotes.filter((q: any) => {
    const d = q.doc_date
    if (!d) return true
    if (dateFrom && d < dateFrom) return false
    if (dateTo && d > dateTo) return false
    return true
  })

  const items = await getItems()
  const itemMap = new Map(items.map(i => [i.code, i]))

  const demandMap = new Map<string, { count: number; qty: number }>()

  // Fetch line items from sample quotes
  const recentQuotes = quotes.slice(0, 50)
  for (let i = 0; i < recentQuotes.length; i += 20) {
    const batch = recentQuotes.slice(i, i + 20)
    const details = await Promise.all(
      batch.map(async (q: any) => {
        try { return await fetchDocumentDetail(31, q.doc_number) } catch { return null }
      })
    )
    for (const detail of details) {
      if (!detail?.lines) continue
      for (const line of detail.lines) {
        const code = line.item_code
        if (!code || code.length <= 1) continue
        const existing = demandMap.get(code) || { count: 0, qty: 0 }
        existing.count += 1
        existing.qty += line.quantity || 1
        demandMap.set(code, existing)
      }
    }
  }

  // Also add items with inquiry_count
  for (const item of items) {
    if (item.inquiry_count > 0 && !demandMap.has(item.code)) {
      demandMap.set(item.code, { count: Math.round(item.inquiry_count), qty: Math.round(item.inquiry_count) })
    }
  }

  const result: DemandItem[] = Array.from(demandMap.entries())
    .filter(([code]) => code.length > 1)
    .map(([code, data]) => {
      const item = itemMap.get(code)
      return {
        code,
        name: item?.name || code,
        request_count: data.count,
        total_qty_requested: data.qty,
        stock_qty: item?.stock_qty || 0,
        price: item?.price || 0,
      }
    })
    .sort((a, b) => b.request_count - a.request_count)

  await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
  return result
}

// ── Sales Analytics ──

export async function getSalesData(period: string = '30d'): Promise<SalesDataPoint[]> {
  const cacheKey = `analytics:sales:${period}`
  const cached = await getCached<SalesDataPoint[]>(cacheKey)
  if (cached) return cached

  const now = new Date()
  let dateFrom: string

  switch (period) {
    case '7d': dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]; break
    case '30d': dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]; break
    case '90d': dateFrom = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]; break
    case 'ytd': dateFrom = `${now.getFullYear()}-01-01`; break
    case '1y': dateFrom = new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0]; break
    default: dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]
  }

  try {
    const allInvoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 5000)

    const invoices = allInvoices.filter((inv: any) => {
      const d = inv.doc_date
      return d && d >= dateFrom && d <= now.toISOString().split('T')[0]
    })

    const dateMap = new Map<string, { revenue: number; count: number }>()
    for (const inv of invoices) {
      const date = inv.doc_date
      if (!date) continue
      const dateKey = date.split('T')[0]
      const existing = dateMap.get(dateKey) || { revenue: 0, count: 0 }
      existing.revenue += inv.grand_total || inv.total || 0
      existing.count += 1
      dateMap.set(dateKey, existing)
    }

    const result: SalesDataPoint[] = Array.from(dateMap.entries())
      .map(([date, data]) => ({ date, revenue: data.revenue, count: data.count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
    return result
  } catch (e) {
    console.error('[Analytics] Sales data failed:', e)
    return []
  }
}

// ── Seasonal Correlation ──

export async function getSeasonalData(): Promise<SeasonalDataPoint[]> {
  const cacheKey = 'analytics:seasonal:v3'
  const cached = await getCached<SeasonalDataPoint[]>(cacheKey)
  if (cached) return cached

  // Try DB first (populated by /api/sync)
  try {
    const dbResult = await dbQuery(
      `SELECT month, season, SUM(revenue) as total_revenue, SUM(quantity) as total_qty, SUM(invoice_count) as total_count
       FROM dashboard.monthly_sales
       GROUP BY month, season
       ORDER BY month`
    )

    if (dbResult.rows.length > 0) {
      const maxSales = Math.max(...dbResult.rows.map((r: any) => parseFloat(r.total_revenue || '0')), 1)
      const result: SeasonalDataPoint[] = dbResult.rows.map((row: any) => ({
        category: row.season === 'summer' ? 'Summer' : 'Winter',
        month: row.month,
        month_name: MONTH_NAMES[row.month - 1] || 'Unknown',
        avg_sales: parseFloat(row.total_revenue || '0'),
        intensity: parseFloat(row.total_revenue || '0') / maxSales,
      }))
      await setCache(cacheKey, result, CACHE_TTL.SEASONAL)
      return result
    }
  } catch (e) {
    console.warn('[Analytics] DB seasonal query failed, falling back to invoices:', e)
  }

  // Fallback: build from invoice headers
  try {
    const allInvoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 5000)
    const monthMap = new Map<number, { total: number; count: number }>()
    for (const inv of allInvoices) {
      const d = inv.doc_date
      if (!d) continue
      const month = parseInt(d.substring(5, 7), 10)
      const existing = monthMap.get(month) || { total: 0, count: 0 }
      existing.total += inv.grand_total || inv.total || 0
      existing.count += 1
      monthMap.set(month, existing)
    }

    if (monthMap.size === 0) {
      console.warn('[Analytics] No invoices found for seasonal data')
      return []
    }

    const maxSales = Math.max(...[...monthMap.values()].map(v => v.total), 1)
    const result: SeasonalDataPoint[] = [...monthMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([month, data]) => {
        const season = [5, 6, 7, 8, 9, 10].includes(month) ? 'Summer' : 'Winter'
        return {
          category: season,
          month,
          month_name: MONTH_NAMES[month - 1] || 'Unknown',
          avg_sales: data.total,
          intensity: data.total / maxSales,
        }
      })

    await setCache(cacheKey, result, CACHE_TTL.SEASONAL)
    return result
  } catch (e) {
    console.error('[Analytics] Seasonal fallback also failed:', e)
    return []
  }
}

// ── Dead Stock ──

export async function getDeadStock(yearsThreshold: number = 1): Promise<DeadStockItem[]> {
  const cacheKey = `analytics:dead-stock:${yearsThreshold}`
  const cached = await getCached<DeadStockItem[]>(cacheKey)
  if (cached) return cached

  const items = await getItems()
  const currentYear = new Date().getFullYear()

  const deadStock: DeadStockItem[] = items
    .filter(item => {
      if (item.stock_qty <= 0) return false
      if (yearsThreshold === 1) return item.sold_this_year === 0 && item.sold_last_year === 0
      if (yearsThreshold === 2) return item.sold_this_year === 0 && item.sold_last_year === 0 && item.sold_2_years_ago === 0
      return item.sold_this_year === 0 && item.sold_last_year === 0 && item.sold_2_years_ago === 0 && item.sold_3_years_ago === 0
    })
    .map(item => {
      let lastSoldYear = 0
      if (item.sold_this_year > 0) lastSoldYear = currentYear
      else if (item.sold_last_year > 0) lastSoldYear = currentYear - 1
      else if (item.sold_2_years_ago > 0) lastSoldYear = currentYear - 2
      else if (item.sold_3_years_ago > 0) lastSoldYear = currentYear - 3

      return {
        code: item.code,
        name: item.name,
        stock_qty: item.stock_qty,
        price: item.price,
        capital_tied: item.stock_qty * item.price,
        last_sold_year: lastSoldYear,
        years_dead: lastSoldYear > 0 ? currentYear - lastSoldYear : 4,
        category: item.category,
      }
    })
    .filter(item => item.capital_tied > 0)
    .sort((a, b) => b.capital_tied - a.capital_tied)

  await setCache(cacheKey, deadStock, CACHE_TTL.ANALYTICS)
  return deadStock
}

// ── Reorder Recommendations ──

export async function getReorderRecommendations(): Promise<ReorderItem[]> {
  const cacheKey = 'analytics:reorder'
  const cached = await getCached<ReorderItem[]>(cacheKey)
  if (cached) return cached

  const items = await getItems()

  const reorderItems: ReorderItem[] = items
    .filter(item => item.inquiry_count > 0 || item.sold_this_year > 0)
    .map(item => {
      const incomingQty = item.incoming_qty || 0
      const urgencyScore = (item.inquiry_count * 3 + item.sold_this_year * 2) /
        Math.max(item.stock_qty + incomingQty, 1)

      const demandVelocity = Math.min(item.sold_this_year / Math.max(item.sold_last_year, 1), 2)
      const stockCoverage = item.stock_qty / Math.max(item.sold_this_year / 12, 1)
      const seasonalRelevance = 0.5
      const customerBreadth = Math.min(item.inquiry_count / 10, 1)

      return {
        code: item.code,
        name: item.name,
        stock_qty: item.stock_qty,
        incoming_qty: incomingQty,
        inquiry_count: Math.round(item.inquiry_count),
        sold_this_year: Math.round(item.sold_this_year),
        sold_last_year: Math.round(item.sold_last_year),
        price: item.price,
        urgency_score: Math.round(urgencyScore * 100) / 100,
        demand_velocity: Math.round(demandVelocity * 100) / 100,
        stock_coverage: Math.round(stockCoverage * 10) / 10,
        seasonal_relevance: seasonalRelevance,
        customer_breadth: Math.round(customerBreadth * 100) / 100,
      }
    })
    .sort((a, b) => b.urgency_score - a.urgency_score)

  await setCache(cacheKey, reorderItems, CACHE_TTL.ANALYTICS)
  return reorderItems
}

// ── Top Selling Items ──

export async function getTopSellingItems(period: string = '30d'): Promise<TopSellingItem[]> {
  const cacheKey = `analytics:top-items:${period}`
  const cached = await getCached<TopSellingItem[]>(cacheKey)
  if (cached) return cached

  const now = new Date()
  let dateFrom: string

  switch (period) {
    case '7d': dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]; break
    case '30d': dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]; break
    case '90d': dateFrom = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]; break
    case 'ytd': dateFrom = `${now.getFullYear()}-01-01`; break
    case '1y': dateFrom = new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0]; break
    default: dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]
  }

  try {
    const allInvoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 5000)
    const invoices = allInvoices.filter((inv: any) => {
      const d = inv.doc_date
      return d && d >= dateFrom && d <= now.toISOString().split('T')[0]
    })

    // Fetch line items from invoices to aggregate by item
    const itemSales = new Map<string, { name: string; qty: number; revenue: number; count: number }>()

    for (let i = 0; i < invoices.length; i += 20) {
      const batch = invoices.slice(i, i + 20)
      const details = await Promise.all(
        batch.map(async (doc: any) => {
          try { return await fetchDocumentDetail(11, doc.doc_number) } catch { return null }
        })
      )
      for (const detail of details) {
        if (!detail?.lines) continue
        for (const line of detail.lines) {
          if (!line.item_code || line.item_code.length <= 1) continue
          const existing = itemSales.get(line.item_code) || { name: line.item_name || line.item_code, qty: 0, revenue: 0, count: 0 }
          existing.qty += line.quantity || 0
          existing.revenue += line.line_total || 0
          existing.count += 1
          if (line.item_name) existing.name = line.item_name
          itemSales.set(line.item_code, existing)
        }
      }
    }

    // Get stock data for top items
    const items = await getItems()
    const stockMap = new Map(items.map(i => [i.code, i.stock_qty]))

    const result: TopSellingItem[] = Array.from(itemSales.entries())
      .map(([code, data]) => ({
        code,
        name: data.name,
        total_qty_sold: Math.round(data.qty),
        total_revenue: Math.round(data.revenue),
        invoice_count: data.count,
        avg_price: data.qty > 0 ? Math.round(data.revenue / data.qty) : 0,
        stock_qty: stockMap.get(code) || 0,
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20)

    await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
    return result
  } catch (e) {
    console.error('[Analytics] Top selling items failed:', e)
    return []
  }
}
