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
  RecommendationReport,
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

// One-call bulk balance source, pinned to the same healthy .109 box. It walks
// 7UPD for every customer server-side, so it needs far more than the 15s the
// AR client allows (measured: 8-14s, but a loaded box is slower).
const fallbackBulkClient = createClient({
  baseUrl: fallbackBase,
  baseUrls: [fallbackBase],
  credentials: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS', '')
  },
  credentialsByUrl: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS_FALLBACK', '') || undefined
  },
  concurrency: 1,
  timeout: 120000,
})

export interface DebtorBalance { code: string; name: string; balance: number }

/**
 * Every customer who owes money, with their exact net balance — in ONE call.
 *
 * `/api/customers/{code}/balance` has no batch form, so /api/analytics/receivables
 * used to ask all ~4,708 customers one at a time (0.62s each): that is the whole
 * 216s of that route. `POST /api/ledger/bulk/preview` computes the same figure
 * (Σ 7UPD debit − Σ credit) for every customer in a single server-side pass and
 * returns the ones above `min_balance`. Verified against the per-customer path on
 * 2026-08-18: identical debtor set, identical balances to the shekel, 8.3s.
 *
 * **It sends nothing.** `preview` only RESOLVES the audience for a bulk ledger
 * run — the sending endpoint is the separate `/api/ledger/bulk/send`, which this
 * app never calls. We use it purely as the bulk read of balances FINAPI lacks.
 *
 * Returns [] on any failure so the caller can fall back to the per-customer sweep.
 */
export async function fetchDebtorBalances(minBalance = 0): Promise<DebtorBalance[]> {
  try {
    const data: any = await fallbackBulkClient.post('/api/ledger/bulk/preview', { min_balance: minBalance })
    const rows: any[] = data?.recipients || []
    return rows
      .map((r) => ({
        code: String(r?.code || '').trim(),
        name: String(r?.name || '').trim(),
        balance: Number(r?.balance) || 0,
      }))
      .filter((r) => r.code && r.balance > 0)
  } catch (e: any) {
    console.warn('[FINAPI] fetchDebtorBalances failed:', e?.message?.substring(0, 160))
    return []
  }
}

// Customer order/receipt/document history: FINAPI walks a whole Btrieve file per
// call (40-60s for busy customers; its own gateway 504s at 60s), so the default
// 15s client aborts these and the customer page silently loses its tabs. History
// pulls get a dedicated client whose timeout sits under FINAPI's 60s ceiling but
// far above the warm-path cost, and a small concurrency so the three history
// calls of one page view can't crowd FINAPI's 20-seat limiter.
const historyClient = createClient({
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
  concurrency: 3,
  timeout: 55000,
})

export async function fetchCustomerOrdersSlow(code: string, params?: Record<string, any>): Promise<any> {
  return historyClient.customers.getOrders(code, params as any)
}

export async function fetchCustomerReceiptsSlow(code: string, params?: Record<string, any>): Promise<any> {
  return historyClient.customers.getReceipts(code, params as any)
}

export async function fetchCustomerDocumentsSlow(code: string, params?: Record<string, any>): Promise<any> {
  return historyClient.customers.getDocuments(code, params as any)
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

/**
 * Chain links (code → new_item_id / old_item_id) for the WHOLE catalog.
 *
 * fetchItems() is capped at 10k rows while the catalog holds ~113k, so items
 * past the window never contribute their chain links and superseded codes
 * surface as separate analytics rows (the old code shows its own shelf qty —
 * often 0, flagging a false critical — while the successor holds the stock).
 * /api/stream/items streams every item as NDJSON in ~70s; only the ~24k rows
 * that actually carry a link are kept. Callers must cache the result — never
 * fetch this on a request path.
 */
export async function fetchAllItemChainLinks(): Promise<Array<{ code: string; new_item_id?: string; old_item_id?: string }>> {
  const res = await bulkClient.getRaw('/api/stream/items')
  const links: Array<{ code: string; new_item_id?: string; old_item_id?: string }> = []
  if (!res.body) return links
  const push = (line: string) => {
    if (!line) return
    try {
      const row = JSON.parse(line)
      if (row?.code && (row.new_item_id || row.old_item_id)) {
        links.push({
          code: row.code,
          new_item_id: row.new_item_id || undefined,
          old_item_id: row.old_item_id || undefined,
        })
      }
    } catch { /* skip malformed NDJSON line */ }
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      push(buf.slice(0, nl).trim())
      buf = buf.slice(nl + 1)
    }
  }
  push(buf.trim())
  return links
}

export async function fetchItemDetail(code: string): Promise<any> {
  return client.items.get(code)
}

// FINAPI's batch endpoints reject >100 item_codes (HTTP 422). Chunk at 100.
const BATCH_LIMIT = 100

/**
 * Run one of FINAPI's batch endpoints over an arbitrary number of codes.
 *
 * Chunks at 100 (the server's hard limit) and keeps a few chunks in flight: the
 * transport allows 4 concurrent calls, so 3 gives most of the speed-up while
 * leaving a seat for whatever else the container is doing. A chunk that fails is
 * logged and dropped — batch callers all degrade to "keep what we have" rather
 * than failing a page, which is why every one of them swallowed errors already.
 */
const BATCH_IN_FLIGHT = 3

async function runChunked<T>(codes: string[], label: string, call: (chunk: string[]) => Promise<T>): Promise<T[]> {
  const chunks: string[][] = []
  for (let i = 0; i < codes.length; i += BATCH_LIMIT) chunks.push(codes.slice(i, i + BATCH_LIMIT))
  const out: T[] = []
  for (let i = 0; i < chunks.length; i += BATCH_IN_FLIGHT) {
    const results = await Promise.all(
      chunks.slice(i, i + BATCH_IN_FLIGHT).map(async (cs) => {
        try {
          return await call(cs)
        } catch (e: any) {
          console.warn(`[FINAPI] ${label} chunk failed:`, e?.message?.substring(0, 120))
          return null
        }
      }),
    )
    for (const r of results) if (r != null) out.push(r)
  }
  return out
}

/**
 * Fetch many items in one shot — the batch form of `fetchItemDetail`.
 *
 * Returns a Map keyed by the REQUESTED code (uppercased); the value is the exact
 * payload `GET /api/items/{code}` returns (name, price, stock/ordered/incoming,
 * sales history, chain, categories). Codes FINAPI doesn't know are simply absent
 * from the map — same shape as a failed single lookup, so callers keep their
 * "leave the old value" behaviour without special-casing.
 *
 * Why: every per-item fan-out in this app used to pay one HTTP round trip per
 * code through a transport capped at 4 in-flight requests. 100 codes cost ~53s
 * that way and ~1.8s as one batch call.
 */
export async function fetchItemsBatch(codes: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  const unique = [...new Set((codes || []).map(c => String(c || '').trim().toUpperCase()).filter(Boolean))]
  if (!unique.length) return out

  // A dropped chunk costs 100 codes at once (a dropped single lookup cost one),
  // so retry it once before letting runChunked give up on it.
  const parts = await runChunked(unique, 'fetchItemsBatch', async (cs) => {
    try {
      return (await client.items.batch(cs)) as any
    } catch {
      await new Promise(r => setTimeout(r, 300))
      return (await client.items.batch(cs)) as any
    }
  })
  for (const data of parts) {
    for (const item of data?.items || []) {
      const code = String(item?.code || item?.item_code || '').trim().toUpperCase()
      if (code) out.set(code, item)
    }
  }
  return out
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
  const parts = await runChunked(codes, 'fetchBatchStock', (cs) => client.stock.batch(cs))
  return parts.flatMap((data: any) => (data as any).items || data || [])
}

export async function fetchBatchStockGet(codes: string[]): Promise<any[]> {
  if (!codes.length) return []
  const parts = await runChunked(codes, 'fetchBatchStockGet', (cs) =>
    client.stock.batchGet(cs.map(c => c.toUpperCase()).join(',')))
  return parts.flatMap((data: any) => (data as any).items || data || [])
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

/**
 * FINAPI's recommendation report — the same engine behind the /items/recommendations
 * page, and the demand source of truth for reorder suggestions.
 *
 * Scans real document lines in [date_from, date_to]: quotes (31) and net invoices
 * (11/13/19 minus 12 credit notes), joined to stock and the open 61/62 pipeline.
 *
 * Defaults here are deliberate and differ from the web page's:
 *   - method=coverage over 3 months, so the number is INDEPENDENT of the window
 *     length. The page defaults to shortfall over 6 months, which recommends
 *     re-buying everything sold in the window — that figure moves whenever
 *     someone changes the date picker.
 *   - sources includes 31, so asked_qty (נשאל) is real. The page's default
 *     excludes quotes, which is why its asked_qty column is 0 on every row.
 *
 * HEAVY: 60-120s. Uses bulkClient (180s timeout). FINAPI caches an identical
 * parameter set for 10 minutes, but only the PAGE's default combo is pre-warmed,
 * so this call pays the scan. Callers must cache — never hit this on a request path.
 */
export async function fetchRecommendationReport(opts: {
  windowDays?: number
  method?: 'shortfall' | 'coverage' | 'reorder_point' | 'minmax'
  coverageMonths?: number
  rateWindowDays?: number
  sources?: string
  minDemand?: number
} = {}): Promise<RecommendationReport> {
  const windowDays = opts.windowDays ?? 90
  const to = new Date()
  const from = new Date(to.getTime() - windowDays * 86400000)
  const data = await bulkClient.get('/api/export/recommendation-report', {
    date_from: from.toISOString().slice(0, 10),
    date_to: to.toISOString().slice(0, 10),
    sources: opts.sources ?? '31,11,13,19',
    method: opts.method ?? 'coverage',
    coverage_months: opts.coverageMonths ?? 3,
    rate_window_days: opts.rateWindowDays ?? 90,
    min_demand: opts.minDemand ?? 1,
    format: 'json',
  })
  return { rows: data?.rows ?? [], meta: data?.meta ?? {} }
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

export interface BulkDocumentLine {
  item_code: string
  item_name: string
  quantity: number
  unit_price: number
  discount_percent: number
  line_total: number
}

export interface BulkDocument {
  doc_format: string
  doc_number: string
  doc_date: string
  customer_code: string
  customer_name: string
  total: number
  lines: BulkDocumentLine[]
}

/**
 * The newest `count` documents of one format, WITH their line items, in ONE call.
 *
 * The aggregation loops in this app used to fetch one document at a time — the
 * warm-cache monthly-sales sync alone paid 1,000 round trips. FINAPI's change
 * feed returns the same documents with complete lines in a single request
 * (measured: 971 docs in 5.8s; per-doc line counts match GET /api/documents/{f}/{n}
 * exactly on every sampled doc, including 10-line ones).
 *
 * **Returns null — meaning "use the per-document path" — rather than degrading.**
 * The one field the feed historically omitted is `line_total`, and a caller doing
 * `revenue += line.line_total || 0` against a feed without it gets a confident
 * ZERO. It cannot be recomputed either: qty * unit_price * (1 - disc/100)
 * disagrees with the ERP on ~9% of real lines (14,204 ILS of drift across 25
 * documents). So we verify the field is actually there and bail out if it is not
 * — which is exactly what happens against a FINAPI older than the change that
 * added it, and against the .109 fallback box until it is updated too.
 *
 * Also returns null for: a non-active year (the feed serves the active year
 * only), a failed call, or an empty feed.
 *
 * NOT for format 61 (supplier orders): those carry ~159 lines each, and the feed
 * took 65s for 137 of them versus 2.4s for 200 invoices. Bounded per-document
 * fetches win there.
 */
export async function fetchRecentDocumentsWithLines(
  format: number | string,
  count: number,
  year?: string,
): Promise<BulkDocument[] | null> {
  const fmt = String(format)
  // The feed reads the active year only; anything else must take the old path.
  if (year && year !== String(new Date().getFullYear())) return null

  try {
    const head = await client.documents.list(fmt, { limit: 1, direction: 'desc' })
    const newest = (head?.documents || head || [])[0]
    const maxNum = parseInt(String(newest?.doc_number ?? newest?.number ?? '').trim(), 10)
    if (!Number.isFinite(maxNum) || maxNum <= 0) return null

    // The feed returns documents numbered ABOVE the cursor, so a cursor of
    // (newest - count) asks for the most recent `count` — the same window
    // fetchDocuments(fmt, count) walks. Gaps in numbering just mean fewer rows.
    const cursor = `${fmt}:${Math.max(0, maxNum - count)}`
    const data: any = await bulkClient.get('/api/documents/changes', {
      formats: fmt,
      cursor,
      limit: Math.min(2000, Math.max(1, count)),
      include_lines: true,
      resync_days: 0,
    })

    const rows: any[] = (data?.documents || []).filter((r: any) => Array.isArray(r?.lines) && r.lines.length)
    if (rows.length === 0) return null

    // The guard. One line without a usable line_total invalidates the whole feed
    // for revenue purposes — do not partially trust it.
    for (const r of rows) {
      for (const l of r.lines) {
        if (typeof l?.line_total !== 'number' || Number.isNaN(l.line_total)) {
          console.warn(
            `[FINAPI] changes feed for format ${fmt} has no line_total — falling back to per-document reads. ` +
            'Update FINAPI on this box to get the one-call path.',
          )
          return null
        }
      }
    }

    return rows.map((r) => ({
      doc_format: String(r.doc_format ?? fmt),
      doc_number: String(r.doc_number ?? '').trim(),
      doc_date: String(r.doc_date ?? ''),
      customer_code: String(r.customer_code ?? ''),
      customer_name: String(r.customer_name ?? ''),
      total: Number(r.total) || 0,
      lines: r.lines.map((l: any) => ({
        item_code: String(l.item_code ?? '').trim(),
        item_name: String(l.item_name ?? ''),
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        discount_percent: Number(l.discount_percent) || 0,
        line_total: Number(l.line_total) || 0,
      })),
    }))
  } catch (e: any) {
    console.warn('[FINAPI] fetchRecentDocumentsWithLines failed, using per-document path:', e?.message?.substring(0, 140))
    return null
  }
}

/**
 * Recent documents of one format WITH their lines — one feed call when the box
 * can serve it, the per-document walk otherwise. Callers consume the same shape
 * either way (`doc_date`, `doc_number`, `lines[]`), so nothing downstream cares
 * which path ran.
 *
 * This exists because six separate places had hand-rolled the same
 * "chunk the doc list, Promise.all a fetchDocumentDetail per doc" loop.
 */
export async function fetchRecentDocumentDetails(
  format: number | string,
  count: number,
  year?: string,
): Promise<any[]> {
  const bulk = await fetchRecentDocumentsWithLines(format, count, year)
  if (bulk) return bulk

  // Fallback: the old path — list, then one detail call per document, paced.
  const docs = await fetchDocuments(Number(format), count, year)
  const out: any[] = []
  const CHUNK = 20
  for (let i = 0; i < docs.length; i += CHUNK) {
    const details = await Promise.all(
      docs.slice(i, i + CHUNK).map(async (d: any) => {
        try { return await fetchDocumentDetail(format, d.doc_number, year) } catch { return null }
      }),
    )
    for (const d of details) if (d) out.push(d)
  }
  return out
}

/**
 * Details (with lines) for a SPECIFIC set of document numbers — the feed where it
 * covers them, per-document reads for whatever it misses.
 *
 * Unlike fetchRecentDocumentDetails this changes nothing about WHICH documents a
 * caller ends up with: callers that pick their documents by date, status or a
 * cached list keep exactly their own selection. The feed is only used as a bulk
 * READ of documents already chosen, and anything it does not return is fetched
 * individually, so the result is the same set either way.
 */
export async function fetchDocumentDetailsByNumber(
  format: number | string,
  docNumbers: Array<string | number>,
  year?: string,
): Promise<any[]> {
  const wanted = [...new Set(docNumbers.map((n) => String(n ?? '').trim()).filter(Boolean))]
  if (wanted.length === 0) return []

  const byNumber = new Map<string, any>()
  const nums = wanted.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n))
  if (nums.length > 0) {
    // The feed is a contiguous window above a cursor, so it can only serve this
    // set if the set's own span fits in one call.
    const span = Math.max(...nums) - Math.min(...nums) + 1
    if (span <= 2000) {
      const bulk = await fetchRecentDocumentsWithLines(format, span, year)
      if (bulk) {
        const want = new Set(wanted.map((n) => String(parseInt(n, 10))))
        for (const d of bulk) {
          if (want.has(String(parseInt(d.doc_number, 10)))) byNumber.set(String(parseInt(d.doc_number, 10)), d)
        }
      }
    }
  }

  // Gap-fill: documents the feed didn't cover (older than the window, a format it
  // can't serve, or the feed being unusable entirely).
  const missing = wanted.filter((n) => !byNumber.has(String(parseInt(n, 10))))
  const CHUNK = 20
  for (let i = 0; i < missing.length; i += CHUNK) {
    const details = await Promise.all(
      missing.slice(i, i + CHUNK).map(async (n) => {
        try { return await fetchDocumentDetail(format, n, year) } catch { return null }
      }),
    )
    for (const d of details) if (d) byNumber.set(String(parseInt(String(d.doc_number ?? ''), 10)), d)
  }

  // Preserve the caller's order.
  return wanted.map((n) => byNumber.get(String(parseInt(n, 10)))).filter(Boolean)
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

// Bulk line scans on the active year ride FINAPI's Btrieve tier — 45-120s per
// month window. Needs its own client: a generous timeout AND NO failover — the
// fallback box answers this endpoint with 503 ("SQL unavailable and no cached
// documents"), so failing over just converts a slow answer into an error.
const linesClient = createClient({
  baseUrl: process.env.FINANSIT_BASE_URL || FINANSIT_PRIMARY,
  baseUrls: [process.env.FINANSIT_BASE_URL || FINANSIT_PRIMARY],
  credentials: async () => {
    await initializeSecrets()
    return getSecret('FINANSIT_API_CREDENTIALS', '')
  },
  concurrency: 1,
  timeout: 240000,
})

export async function fetchDocumentLinesSlow(params: {
  doc_format?: string; item_code?: string; date_from?: string
  date_to?: string; limit?: number; offset?: number; year?: string
}): Promise<any> {
  return linesClient.documents.getLines(params as any)
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
  const result: Record<string, number> = {}
  const parts = await runChunked(codes, 'fetchBatchPrices', (cs) => client.prices.batch({ item_codes: cs }))
  for (const data of parts) {
    for (const item of (data.items || data || []) as any[]) {
      const code = item.item_code || item.code
      const price = item.price_list_price || item.price || 0
      if (code && price > 0) result[String(code).toUpperCase()] = price
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
  const result: Record<string, number> = {}
  const parts = await runChunked(codes, 'fetchBatchCost', (cs) =>
    client.prices.batch({ item_codes: cs, price_code: COST_PRICE_CODE } as any))
  for (const data of parts) {
    for (const item of (data.items || data || []) as any[]) {
      const code = item.item_code || item.code
      const cost = Number(item.price ?? item.price_list_price ?? 0)
      if (code && cost > 0) result[String(code).toUpperCase()] = cost
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
