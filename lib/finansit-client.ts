/**
 * Finansit ERP API Client — thin wrapper over a direct FINAPI REST client.
 *
 * Transport/auth/concurrency live in ./finapi-rest (ported from the SDK's fetch
 * wrapper) so the dashboard no longer depends on @jan/finansit-sdk / CodeArtifact.
 * The MCP server still runs the real finansit-sdk; only the dashboard is detached.
 * This module preserves the existing function signatures so consumer files
 * (analytics-service, API routes, cron) don't need changes.
 */

import { createClient } from './finapi-rest'
import { getSecret, initializeSecrets } from './aws-secrets'
import type {
  CreateDocumentParams,
  CloneDocumentParams,
  ConvertDocumentParams,
  UpdateDocumentParams,
} from './types'

// FINANSIT_BASE_URL = primary FINAPI box; FINANSIT_BASE_URL_FALLBACK = secondary.
// The client tries primary first and fails over to the fallback on
// connection/timeout/5xx errors (sticky once one works). Defaults to the known
// LAN boxes so the fallback is ALWAYS active even if the env vars are unset:
// primary 192.168.0.111:8000, fallback 192.168.0.109:8000. This matters because
// the primary box intermittently can't open the current-year invoice-detail
// Btrieve file (7IVH.DAT, status 3012), which 503s PDFs / purchases / details —
// the fallback box serves those.
const FINANSIT_PRIMARY = 'http://192.168.0.111:8000'
const FINANSIT_FALLBACK = 'http://192.168.0.109:8000'
const finansitBaseUrls = [
  process.env.FINANSIT_BASE_URL || FINANSIT_PRIMARY,
  process.env.FINANSIT_BASE_URL_FALLBACK || FINANSIT_FALLBACK,
].filter(Boolean) as string[]

const client = createClient({
  baseUrls: finansitBaseUrls.length ? finansitBaseUrls : undefined,
  baseUrl: process.env.FINANSIT_BASE_URL || FINANSIT_PRIMARY,
  credentials: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS', '')
  },
  // The fallback box (192.168.0.109) authenticates with a different login than
  // the primary. Supply it via FINANSIT_API_CREDENTIALS_FALLBACK (email:api_key);
  // falls through to the primary credentials when unset.
  credentialsByUrl: async (base: string) => {
    if (!base.includes('192.168.0.109')) return undefined
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS_FALLBACK', '') || undefined
  },
  // FINAPI is a single uvicorn worker with a 20-seat concurrency limiter; a
  // cold cache turns /api/dashboard + analytics into 60-90s Btrieve scans. Keep
  // our fan-out small so the dashboard can never fill all 20 seats and wedge it
  // (the 503 "Server busy" storm). Warm responses are fast enough at 4 in-flight.
  concurrency: 4,
  timeout: 15000,
})

// Bulk-feed client: /api/stock/all streams the entire catalog (~36MB, can take
// 1-2 min when FINAPI is loaded or freshly rebuilt). The default 15s timeout
// aborts it mid-stream, which silently degrades getItems() into the tiny
// invoice-discovery fallback. Bulk pulls get their own generous timeout.
const bulkClient = createClient({
  baseUrls: finansitBaseUrls.length ? finansitBaseUrls : undefined,
  baseUrl: process.env.FINANSIT_BASE_URL || FINANSIT_PRIMARY,
  credentials: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS', '')
  },
  credentialsByUrl: async (base: string) => {
    if (!base.includes('192.168.0.109')) return undefined
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS_FALLBACK', '') || undefined
  },
  concurrency: 1,
  timeout: 180000,
})

// Dedicated client pinned to the FALLBACK box (192.168.0.109). The primary box
// (.111) has broken AR Btrieve files: balance 500s (which does fail over) but
// aging returns 200 with WRONG residual data (which does NOT fail over). So for
// accounts-receivable (balance + aging) we always go straight to the healthy .109.
const fallbackBase = process.env.FINANSIT_BASE_URL_FALLBACK || FINANSIT_FALLBACK
const fallbackClient = createClient({
  baseUrl: fallbackBase,
  baseUrls: [fallbackBase],
  credentials: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS', '')
  },
  // Prefer the fallback-box login if configured; otherwise reuse primary creds.
  credentialsByUrl: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS_FALLBACK', '') || undefined
  },
  concurrency: 6,
  timeout: 15000,
})

export async function fetchCustomerBalanceFallback(code: string): Promise<any> {
  return fallbackClient.customers.getBalance(code)
}

export async function fetchCustomerAgingFallback(code: string, params?: Record<string, any>): Promise<any> {
  return fallbackClient.customers.getAging(code, params as any)
}

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

// FINAPI's batch endpoints reject >100 item_codes (HTTP 422). Chunk at 100.
const BATCH_LIMIT = 100

export async function fetchBatchStock(codes: string[]): Promise<any[]> {
  if (!codes.length) return []
  const out: any[] = []
  for (let i = 0; i < codes.length; i += BATCH_LIMIT) {
    try {
      const data = await client.stock.batch(codes.slice(i, i + BATCH_LIMIT))
      out.push(...((data as any).items || data || []))
    } catch (e: any) {
      console.warn('[FINAPI] fetchBatchStock chunk failed:', e?.message?.substring(0, 120))
    }
  }
  return out
}

export async function fetchBatchStockGet(codes: string[]): Promise<any[]> {
  if (!codes.length) return []
  const out: any[] = []
  for (let i = 0; i < codes.length; i += BATCH_LIMIT) {
    try {
      const chunk = codes.slice(i, i + BATCH_LIMIT).map(c => c.toUpperCase()).join(',')
      const data = await client.stock.batchGet(chunk)
      out.push(...((data as any).items || data || []))
    } catch (e: any) {
      console.warn('[FINAPI] fetchBatchStockGet chunk failed:', e?.message?.substring(0, 120))
    }
  }
  return out
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
        const data = await bulkClient.stock.getAll()
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
    const data = await bulkClient.stock.getAll()
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
    const data = await bulkClient.stock.getAll()
    return data.items || []
  } catch (e: any) {
    if (e?.message?.includes('404') || e?.message?.includes('503')) {
      console.log('[FINAPI] Stock cache not ready, triggering rebuild and waiting...')
      try { await refreshCache('stock') } catch (err) { console.warn('[FINAPI] Stock refresh trigger failed:', err) }
      const ready = await waitForStockCache(maxWaitMs)
      if (!ready) return []
      const data = await bulkClient.stock.getAll()
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
}): Promise<any> {
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
    const items: any[] = (data as any).customers || (data as any).items || data || []
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
  const CHUNK = 100 // FINAPI /api/prices/batch rejects >100 item_codes (422)
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

// FINAPI price code holding the purchase/cost price (verified valid codes:
// 01 RETAIL, 06 COST, 12 AGENT, 03-08 SUPPLIER_*). Used for gross-margin.
export const COST_PRICE_CODE = '06'

/**
 * Per-unit cost (price_code 06 = COST) for many items. Returns { CODE: cost }.
 * Mirrors fetchBatchPrices but requests the COST price list. Degrades to an
 * empty map on failure so margin callers fall back to "cost pending".
 */
export async function fetchBatchCost(codes: string[]): Promise<Record<string, number>> {
  if (!codes.length) return {}
  const CHUNK = 100
  const result: Record<string, number> = {}
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK)
    try {
      const data = await client.prices.batch({ item_codes: chunk, price_code: COST_PRICE_CODE } as any)
      const items: any[] = data.items || data || []
      for (const item of items) {
        const code = item.item_code || item.code
        const cost = Number(item.price ?? item.price_list_price ?? 0)
        if (code && cost > 0) result[String(code).toUpperCase()] = cost
      }
    } catch (e) {
      console.warn('[FINAPI] fetchBatchCost chunk failed:', e)
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
