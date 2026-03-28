/**
 * Finansit ERP API Client — Thin wrapper over @jan/finansit-sdk.
 *
 * All HTTP transport, auth, and concurrency are handled by the SDK.
 * This module preserves the existing function signatures so consumer
 * files (analytics-service, API routes, cron) don't need changes.
 */

import { createClient } from '@jan/finansit-sdk'
import { getSecret, initializeSecrets } from './aws-secrets'
import type {
  CreateDocumentParams,
  CloneDocumentParams,
  ConvertDocumentParams,
  UpdateDocumentParams,
} from './types'

const client = createClient({
  credentials: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS', '')
  },
  concurrency: 10,
  timeout: 15000,
})

// ── Health & Utility ──

export async function fetchHealth(): Promise<any> {
  return client.health.check()
}

export async function fetchAvailableYears(): Promise<any> {
  return client.health.years()
}

// ── Items ──

/** Fetch all items (paginated with start param). Returns basic fields only. */
export async function fetchItems(): Promise<any[]> {
  let allItems: any[] = []
  let start = ''
  const limit = 500
  const MAX_PAGES = 20

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, any> = { limit }
    if (start) params.start = start
    const data = await client.items.list(params)
    const items = data.items || []
    if (items.length === 0) break
    allItems = allItems.concat(items)
    if (items.length < limit) break
    const lastCode = items[items.length - 1].code
    if (lastCode === start) break
    start = lastCode
  }

  return allItems
}

export async function fetchItemDetail(code: string): Promise<any> {
  return client.items.get(code)
}

export async function searchItems(query: string): Promise<any[]> {
  const data = await client.items.search(query)
  return data.items || []
}

export async function fetchItemHistory(code: string): Promise<any> {
  return client.items.getHistory(code)
}

export async function fetchItemCategories(): Promise<any> {
  return client.items.listCategories()
}

export async function fetchItemCategoriesForItem(code: string): Promise<any> {
  return client.items.getCategories(code)
}

export async function fetchItemDescription(code: string): Promise<any> {
  return client.items.getDescription(code)
}

// ── Stock ──

export async function fetchStock(code: string, year?: string): Promise<any> {
  return client.stock.get(code, year ? { year } : undefined)
}

export async function fetchBatchStock(codes: string[]): Promise<any[]> {
  if (!codes.length) return []
  const data = await client.stock.batch(codes)
  return data.items || data || []
}

export async function fetchBatchStockGet(codes: string[]): Promise<any[]> {
  if (!codes.length) return []
  const data = await client.stock.batchGet(codes.map(c => c.toUpperCase()).join(','))
  return data.items || data || []
}

export async function refreshCache(table?: string): Promise<void> {
  if (table) {
    await client.cache.refreshTable(table)
  } else {
    await client.cache.refresh()
  }
}

export async function fetchCacheStatus(): Promise<any> {
  try {
    return await client.cache.status()
  } catch {
    return { tables: {} }
  }
}

/** Poll until stock cache has data and is not loading */
export async function waitForStockCache(maxWaitMs = 60000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const status = await fetchCacheStatus()
    const stockCount = Number(status.tables?.stock?.count || 0)
    const isLoading = status.loading?.stock === true
    console.log(`[FINAPI] Cache poll: stock count=${stockCount}, loading=${isLoading}, elapsed=${Date.now() - start}ms`)
    if (stockCount > 0 && !isLoading) {
      console.log(`[FINAPI] Stock cache ready with ${stockCount} items after ${Date.now() - start}ms`)
      return true
    }
    if (!isLoading && stockCount === 0) {
      try {
        const data = await client.stock.getAll()
        if (data.items && data.items.length > 0) {
          console.log(`[FINAPI] Stock /all available with ${data.items.length} items after ${Date.now() - start}ms`)
          return true
        }
      } catch {
        // Not ready yet
      }
    }
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  console.warn(`[FINAPI] Stock cache not ready after ${maxWaitMs}ms`)
  return false
}

let stockRebuildInFlight = false

export async function fetchAllStockItems(): Promise<any[]> {
  try {
    const data = await client.stock.getAll()
    return data.items || []
  } catch (e: any) {
    if (e?.message?.includes('404') || e?.message?.includes('503')) {
      if (!stockRebuildInFlight) {
        stockRebuildInFlight = true
        console.log('[FINAPI] Stock cache not ready, triggering stock-only rebuild (fire-and-forget)...')
        refreshCache('stock')
          .catch((err) => console.warn('[FINAPI] Stock refresh failed:', err))
          .finally(() => { stockRebuildInFlight = false })
      } else {
        console.log('[FINAPI] Stock cache rebuild already in progress, skipping duplicate trigger')
      }
      return []
    }
    throw e
  }
}

export async function fetchAllStockItemsBlocking(maxWaitMs = 180000): Promise<any[]> {
  try {
    const data = await client.stock.getAll()
    return data.items || []
  } catch (e: any) {
    if (e?.message?.includes('404') || e?.message?.includes('503')) {
      console.log('[FINAPI] Stock cache not ready, triggering rebuild and waiting...')
      try { await refreshCache('stock') } catch (err) { console.warn('[FINAPI] Stock refresh trigger failed:', err) }
      const ready = await waitForStockCache(maxWaitMs)
      if (!ready) return []
      const data = await client.stock.getAll()
      return data.items || []
    }
    throw e
  }
}

// ── Documents ──

export async function fetchDocuments(format: number, limit?: number, year?: string): Promise<any[]> {
  const data = await client.documents.list(String(format), { limit, direction: 'desc', year })
  return data.documents || data || []
}

export async function fetchDocumentDetail(format: number | string, number: number | string, year?: string): Promise<any> {
  return client.documents.get(String(format), String(number), year ? { year } : undefined)
}

export async function searchDocuments(params: Record<string, string>): Promise<any[]> {
  const apiParams: Record<string, any> = { ...params }
  if (apiParams.format) {
    apiParams.doc_format = apiParams.format
    delete apiParams.format
  }
  const data = await client.documents.search(apiParams)
  return data.documents || data || []
}

export async function fetchDocumentFormats(params?: { enable_caching?: boolean; year?: string }): Promise<any> {
  return client.documents.listFormats(params as any)
}

export async function fetchDocumentLines(params: {
  doc_format?: string; item_code?: string; date_from?: string
  date_to?: string; limit?: number; year?: string
}): Promise<any[]> {
  return client.documents.getLines(params as any)
}

export async function fetchDocumentPdf(format: number | string, number: number | string, year?: string): Promise<Response> {
  return client.documents.getPdf(String(format), String(number), year ? { year } : undefined)
}

export async function createDocument(params: CreateDocumentParams): Promise<any> {
  return client.documents.create(params)
}

export async function cloneDocument(params: CloneDocumentParams): Promise<any> {
  return client.documents.clone(params)
}

export async function convertDocument(params: ConvertDocumentParams): Promise<any> {
  return client.documents.convert(params)
}

export async function updateDocument(format: number | string, docNumber: number | string, params: UpdateDocumentParams): Promise<any> {
  return client.documents.update(String(format), String(docNumber), params)
}

// ── Dashboard ──

export async function fetchDashboard(year?: string): Promise<any> {
  return client.dashboard.get(year ? { year } : undefined)
}

// ── Customers ──

export async function fetchAllCustomers(): Promise<any[]> {
  const all: any[] = []
  let start = '0000000000'
  const limit = 500
  while (true) {
    const data = await client.customers.list({ start, sort: 'code', direction: 'asc', limit })
    const items: any[] = data.customers || data.items || data || []
    if (!items.length) break
    all.push(...items)
    if (items.length < limit) break
    const lastCode = items[items.length - 1].code || items[items.length - 1].customer_code
    if (!lastCode || lastCode === start) break
    start = lastCode
  }
  return all
}

export async function searchCustomers(query: string, limit?: number): Promise<any[]> {
  const data = await client.customers.search(query, limit)
  return data.customers || []
}

export async function fetchCustomerDetail(code: string): Promise<any> {
  return client.customers.get(code)
}

export async function fetchCustomerBalance(code: string): Promise<any> {
  return client.customers.getBalance(code)
}

export async function fetchCustomerDocuments(code: string, params?: {
  limit?: number; direction?: 'asc' | 'desc'; enable_caching?: boolean; year?: string
}): Promise<any> {
  return client.customers.getDocuments(code, params as any)
}

export async function fetchCustomerOrders(code: string, params?: Record<string, any>): Promise<any> {
  return client.customers.getOrders(code, params)
}

export async function fetchCustomerReceipts(code: string, params?: {
  limit?: number; sort?: string; direction?: 'asc' | 'desc'; year?: string
}): Promise<any> {
  return client.customers.getReceipts(code, params as any)
}

export async function fetchCustomerAging(code: string, params?: {
  enable_caching?: boolean; year?: string
}): Promise<any> {
  return client.customers.getAging(code, params as any)
}

export async function createCustomer(params: Record<string, any>): Promise<any> {
  return client.customers.create(params)
}

// ── Prices ──

export async function fetchBatchPrices(codes: string[]): Promise<Record<string, number>> {
  if (!codes.length) return {}
  const CHUNK = 200
  const result: Record<string, number> = {}
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK)
    try {
      const data = await client.prices.batch({ item_codes: chunk })
      const items: any[] = data.items || data || []
      for (const item of items) {
        const code = item.item_code || item.code
        const price = item.price_list_price || item.price || 0
        if (code && price > 0) result[code.toUpperCase()] = price
      }
    } catch (e) {
      console.warn('[FINAPI] fetchBatchPrices chunk failed:', e)
    }
  }
  return result
}

export async function lookupPrice(itemCode: string, customerCode?: string, priceCode?: string): Promise<any> {
  return client.prices.lookup(itemCode, { customer_code: customerCode, price_code: priceCode })
}

export async function fetchPriceHistory(itemCode: string, priceCode?: string, limit?: number, year?: string): Promise<any> {
  return client.prices.history(itemCode, { price_code: priceCode, limit, year })
}

export async function createPrice(params: Record<string, any>): Promise<any> {
  return client.prices.create(params)
}

// ── Search ──

export async function unifiedSearch(text: string, limit?: number): Promise<any> {
  return client.search.unified(text, limit)
}

// ── PostgreSQL historical analytics ──

export async function queryPg(sql: string, limit = 500): Promise<{ count: number; rows: Record<string, unknown>[] }> {
  return client.pg.query(sql, limit)
}

export async function fetchPgSchema(): Promise<any> {
  return client.pg.schema()
}

export async function fetchPgCustomerStats(year: string, limit?: number): Promise<any> {
  return client.pg.customerStats(Number(year), limit)
}

export async function fetchPgDailySales(dateFrom?: string, dateTo?: string): Promise<any> {
  return client.pg.dailySales(dateFrom || '', dateTo || '')
}

export async function fetchPgMonthlySales(year: string, params?: { month?: number; item_code?: string; limit?: number }): Promise<any> {
  return client.pg.monthlySales(Number(year), params)
}

export async function fetchPgFormatSummary(year: string): Promise<any> {
  return client.pg.formatSummary(Number(year))
}

export async function fetchPgItemSnapshot(itemCode?: string, limit?: number): Promise<any> {
  return client.pg.itemSnapshot({ item_code: itemCode, limit })
}

// ── SQL (Pervasive ODBC) ──

export async function fetchSqlQuery(query: string, year?: string): Promise<any> {
  return client.sql.query(query, { year })
}

export async function fetchSqlTables(year?: string): Promise<any> {
  return client.sql.tables(year ? { year } : undefined)
}

export async function fetchSqlColumns(table: string, year?: string): Promise<any> {
  return client.sql.columns(table, year ? { year } : undefined)
}

export async function fetchSqlIndexes(table: string, year?: string): Promise<any> {
  return client.sql.indexes(table, year ? { year } : undefined)
}

// ── Export ──

export async function fetchExportDocuments(params: Record<string, any>): Promise<Response> {
  return client.export.documents(params)
}

export async function fetchExportAging(code: string, params?: Record<string, any>): Promise<Response> {
  return client.export.aging(code, params)
}

export async function fetchExportPrices(itemCode: string, params?: Record<string, any>): Promise<Response> {
  return client.export.prices(itemCode, params)
}

export async function fetchExportStock(params?: Record<string, any>): Promise<Response> {
  return client.export.stock(params)
}

// ── Legacy export for consumers that import callEndpoint directly ──

export { client }
