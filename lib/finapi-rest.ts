/**
 * Direct FINAPI REST client — replaces @jan/finansit-sdk inside the dashboard so
 * the dashboard build no longer depends on the private SDK package (and thus no
 * AWS CodeArtifact at build time).
 *
 * Ported verbatim from the SDK's transport — which was itself only a manual
 * `fetch` wrapper. Differences:
 *   - streaming (NDJSON) methods dropped (the dashboard never used them)
 *   - batch endpoints chunk at 100 (FINAPI rejects >100 item_codes with HTTP 422)
 *
 * The MCP server still runs the real @jan/finansit-sdk; only the dashboard is
 * detached from it.
 */

export class FinansitApiError extends Error {
  status: number
  body: string
  path: string
  constructor(status: number, body: string, path: string) {
    super(`FINAPI ${status} on ${path}: ${body.slice(0, 200)}`)
    this.status = status
    this.body = body
    this.path = path
    this.name = 'FinansitApiError'
  }
}

class Semaphore {
  private queue: Array<() => void> = []
  private active = 0
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve() }))
  }
  release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

const BATCH_LIMIT = 100 // FINAPI batch endpoints reject >100 item_codes (422)
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export interface FinapiClientConfig {
  /** Single base URL. Ignored when `baseUrls` is provided. */
  baseUrl?: string
  /** Ordered base URLs: primary first, then fallbacks. Overrides `baseUrl`. */
  baseUrls?: string[]
  credentials: string | (() => Promise<string> | string)
  /** Optional per-base-URL credentials (e.g. the fallback box uses a different
   *  login). Returns `email:api_key` for that base, or undefined to use the
   *  default `credentials`. */
  credentialsByUrl?: (baseUrl: string) => Promise<string | undefined> | string | undefined
  concurrency?: number
  timeout?: number
}

export function createClient(config: FinapiClientConfig) {
  // Primary first, then fallbacks. Failover triggers on connection-level failures
  // (timeout/abort, refused, DNS, reset) and 5xx — NOT on 4xx (the box answered).
  const baseUrls = (config.baseUrls?.length ? config.baseUrls : [config.baseUrl ?? 'https://finansit.jan.parts'])
    .map((u) => u.replace(/\/$/, ''))
  const timeout = config.timeout ?? 15000
  const semaphore = config.concurrency ? new Semaphore(config.concurrency) : null
  const authHeaderByBase = new Map<string, string>() // per-base (boxes can differ)
  let activeIdx = 0 // sticky: stay on the last base URL that worked

  async function getAuthHeader(base: string): Promise<string> {
    const cached = authHeaderByBase.get(base)
    if (cached) return cached
    const override = config.credentialsByUrl ? await config.credentialsByUrl(base) : undefined
    const creds = override
      || (typeof config.credentials === 'function' ? await config.credentials() : config.credentials)
    const header = `Basic ${Buffer.from(creds).toString('base64')}`
    authHeaderByBase.set(base, header)
    return header
  }

  function buildUrl(base: string, path: string, params?: Record<string, any>): string {
    const url = new URL(path, base)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }

  function shouldFailover(e: any, retryOn500 = false): boolean {
    // 502/503/504 → box unreachable/overloaded, always safe to retry. 500 →
    // only retry for idempotent GETs (e.g. the primary box failing to open a
    // Btrieve file 500s PDFs/details that the fallback box can serve); never
    // retry a 500 on a mutation (could double-write).
    if (e instanceof FinansitApiError) return e.status >= (retryOn500 ? 500 : 502)
    const code = e?.code
    return (
      e?.name === 'AbortError' || // our timeout fired
      e instanceof TypeError || // fetch() network failure (refused, DNS, etc.)
      code === 'ECONNREFUSED' || code === 'ENOTFOUND' ||
      code === 'EHOSTUNREACH' || code === 'ECONNRESET' || code === 'ETIMEDOUT'
    )
  }

  // Run `attempt` against the active base URL; on a connection-level error fail
  // over to the remaining base URLs in order. Each attempt gets its own timeout.
  async function withFailover<T>(attempt: (base: string, signal: AbortSignal) => Promise<T>, retryOn500 = false): Promise<T> {
    if (semaphore) await semaphore.acquire()
    try {
      const order = [activeIdx, ...baseUrls.map((_, i) => i).filter((i) => i !== activeIdx)]
      let lastErr: any
      for (let n = 0; n < order.length; n++) {
        const idx = order[n]
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)
        try {
          const out = await attempt(baseUrls[idx], controller.signal)
          activeIdx = idx // stick to the box that worked
          return out
        } catch (e: any) {
          lastErr = e
          if (n < order.length - 1 && shouldFailover(e, retryOn500)) {
            console.warn(`[finapi] ${baseUrls[idx]} failed (${e?.name || e?.code || e?.status || 'error'}); failing over to ${baseUrls[order[n + 1]]}`)
            continue
          }
          throw e
        } finally {
          clearTimeout(timer)
        }
      }
      throw lastErr
    } finally {
      if (semaphore) semaphore.release()
    }
  }

  async function request(method: string, path: string, params?: Record<string, any>, body?: any): Promise<any> {
    return withFailover(async (base, signal) => {
      const auth = await getAuthHeader(base)
      const url = method === 'GET' ? buildUrl(base, path, params) : buildUrl(base, path)
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: auth,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new FinansitApiError(res.status, text, path)
      }
      return res.json()
    }, method === 'GET') // GETs are idempotent → also fail over on 500
  }

  async function requestRaw(path: string, params?: Record<string, any>): Promise<Response> {
    return withFailover(async (base, signal) => {
      const auth = await getAuthHeader(base)
      const res = await fetch(buildUrl(base, path, params), {
        method: 'GET',
        headers: { Authorization: auth },
        signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new FinansitApiError(res.status, text, path)
      }
      return res
    }, true) // raw fetches are GET-only (PDFs/exports) → fail over on 500 too
  }

  const get = (path: string, params?: Record<string, any>) => request('GET', path, params)
  const post = (path: string, body?: any) => request('POST', path, undefined, body)
  const patch = (path: string, body?: any) => request('PATCH', path, undefined, body)

  // Batch endpoints — chunk at 100 and merge (FINAPI 422s on larger batches).
  async function pricesBatch(data: any): Promise<any> {
    const codes: string[] = (data?.item_codes || []).map((c: string) => c.toUpperCase())
    if (codes.length <= BATCH_LIMIT) return post('/api/prices/batch', { ...data, item_codes: codes })
    const parts = await Promise.all(chunk(codes, BATCH_LIMIT).map((cs) => post('/api/prices/batch', { ...data, item_codes: cs })))
    return { items: parts.flatMap((p: any) => p?.items || []), count: parts.reduce((s: number, p: any) => s + (p?.count || 0), 0) }
  }
  async function stockBatch(itemCodes: string[]): Promise<any> {
    const codes = (itemCodes || []).map((c) => c.toUpperCase())
    if (codes.length <= BATCH_LIMIT) return post('/api/stock/batch', { item_codes: codes })
    const parts = await Promise.all(chunk(codes, BATCH_LIMIT).map((cs) => post('/api/stock/batch', { item_codes: cs })))
    return { items: parts.flatMap((p: any) => p?.items || []) }
  }
  // POST /api/items/batch returns, per code, the identical payload GET
  // /api/items/{code} does — so it replaces an N-call fan-out with N/100 calls
  // (measured on the live box: 100 codes in ~1.8s vs ~53s serially). A code that
  // doesn't exist lands in `not_found` and one that throws in `errors`, so a
  // single bad code never costs the whole chunk.
  async function itemsBatch(itemCodes: string[]): Promise<any> {
    const codes = (itemCodes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean)
    if (codes.length === 0) return { count: 0, items: [], not_found: [], errors: [] }
    if (codes.length <= BATCH_LIMIT) return post('/api/items/batch', { item_codes: codes })
    const parts = await Promise.all(chunk(codes, BATCH_LIMIT).map((cs) => post('/api/items/batch', { item_codes: cs })))
    return {
      count: parts.reduce((s: number, p: any) => s + (p?.count || 0), 0),
      items: parts.flatMap((p: any) => p?.items || []),
      not_found: parts.flatMap((p: any) => p?.not_found || []),
      errors: parts.flatMap((p: any) => p?.errors || []),
    }
  }

  async function stockBatchGet(codes: string, params?: Record<string, any>): Promise<any> {
    const list = String(codes).split(',').filter(Boolean)
    if (list.length <= BATCH_LIMIT) return get('/api/stock/batch', { codes, ...params })
    const parts = await Promise.all(chunk(list, BATCH_LIMIT).map((cs) => get('/api/stock/batch', { codes: cs.join(','), ...params })))
    return { items: parts.flatMap((p: any) => p?.items || []) }
  }

  return {
    get, post, patch, getRaw: requestRaw,
    health: {
      check: () => get('/health'),
      years: () => get('/api/years'),
      yearInfo: (year: any) => get(`/api/years/${year}/info`),
    },
    items: {
      list: (params?: any) => get('/api/items', params),
      search: (q: string, limit?: any) => get('/api/items/search', { q, limit }),
      get: (code: string) => get(`/api/items/${code.toUpperCase()}`),
      batch: (codes: string[]) => itemsBatch(codes),
      getHistory: (code: string) => get(`/api/items/${code.toUpperCase()}/history`),
      getDescription: (code: string) => get(`/api/items/${code.toUpperCase()}/description`),
      setDescription: (code: string, description: any) => post(`/api/items/${code.toUpperCase()}/description`, { description }),
      listCategories: () => get('/api/items/categories'),
      getCategories: (code: string) => get(`/api/items/${code.toUpperCase()}/categories`),
      setCategories: (code: string, categories: any) => post(`/api/items/${code.toUpperCase()}/categories`, { categories }),
      semanticSearch: (query: string, limit?: any) => get('/api/items/semantic-search', { q: query, limit }),
    },
    customers: {
      list: (params?: any) => get('/api/customers', params),
      search: (q: string, limit?: any) => get('/api/customers/search', { q, limit }),
      get: (code: string) => get(`/api/customers/${code}`),
      getBalance: (code: string) => get(`/api/customers/${code}/balance`),
      getAging: (code: string, params?: any) => get(`/api/customers/${code}/aging`, params),
      getDocuments: (code: string, params?: any) => get(`/api/customers/${code}/documents`, params),
      getOrders: (code: string, params?: any) => get(`/api/customers/${code}/orders`, params),
      getReceipts: (code: string, params?: any) => get(`/api/customers/${code}/receipts`, params),
      getUnpaidInvoices: (code: string, params?: any) => get(`/api/customers/${code}/unpaid`, params),
      create: (data: any) => post('/api/customers', data),
    },
    payments: {
      list: (params?: any) => get('/api/clerk/payments', params),
      get: (paymentId: any) => get(`/api/clerk/payments/${paymentId}`),
    },
    documents: {
      listFormats: (params?: any) => get('/api/documents/formats', params),
      list: (format: any, params?: any) => get(`/api/documents/list/${format}`, params),
      search: (params?: any) => get('/api/documents/search', params),
      get: (format: any, number: any, params?: any) => get(`/api/documents/${format}/${number}`, params),
      getLines: (params?: any) => get('/api/documents/lines', params),
      getPdf: (format: any, number: any, params?: any) => requestRaw(`/api/documents/${format}/${number}/pdf`, params),
      create: (data: any) => post('/api/documents', data),
      clone: (data: any) => post('/api/documents/clone', data),
      convert: (data: any) => post('/api/documents/convert', data),
      update: (format: any, number: any, data: any) => patch(`/api/documents/${format}/${number}`, data),
    },
    prices: {
      lookup: (itemCode: string, params?: any) => get('/api/prices/lookup', { item_code: itemCode.toUpperCase(), ...params }),
      batch: (data: any) => pricesBatch(data),
      history: (itemCode: string, params?: any) => get(`/api/prices/${itemCode.toUpperCase()}`, params),
      create: (data: any) => post('/api/prices', data),
    },
    stock: {
      get: (itemCode: string, params?: any) => get(`/api/stock/${itemCode.toUpperCase()}`, params),
      batch: (itemCodes: string[]) => stockBatch(itemCodes),
      batchGet: (codes: string, params?: any) => stockBatchGet(codes, params),
      getAll: (params?: any) => get('/api/stock/all', params),
    },
    serials: {
      list: (itemCode: string, params?: any) => get('/api/serials', { item_code: itemCode, ...params }),
    },
    dashboard: {
      get: (params?: any) => get('/api/dashboard', params),
    },
    cache: {
      status: () => get('/api/cache/status'),
      refresh: () => post('/api/cache/refresh'),
      refreshTable: (table: any) => post(`/api/cache/refresh/${table}`),
    },
    search: {
      unified: (text: string, limit?: any) => get('/api/search', { text, limit }),
    },
    export: {
      documents: (params?: any) => requestRaw('/api/export/documents', params),
      aging: (code: string, params?: any) => requestRaw(`/api/export/aging/${code}`, params),
      prices: (itemCode: string, params?: any) => requestRaw(`/api/export/prices/${itemCode}`, params),
      stock: (params?: any) => requestRaw('/api/export/stock', params),
    },
    sql: {
      query: (q: string, params?: any) => get('/api/sql/query', { q, ...params }),
      tables: (params?: any) => get('/api/sql/tables', params),
      columns: (table: any, params?: any) => get(`/api/sql/columns/${table}`, params),
      indexes: (table: any, params?: any) => get(`/api/sql/indexes/${table}`, params),
    },
    analytics: {
      gap: (params?: any) => get('/api/analytics/gap', params),
    },
    pg: {
      schema: () => get('/api/pg/schema'),
      query: (q: string, limit?: any) => get('/api/pg/query', { q, limit }),
      customerStats: (year: any, limit?: any) => get('/api/pg/customer-stats', { year, limit }),
      dailySales: (dateFrom: any, dateTo: any) => get('/api/pg/daily-sales', { date_from: dateFrom, date_to: dateTo }),
      monthlySales: (year: any, params?: any) => get('/api/pg/monthly-sales', { year, ...params }),
      formatSummary: (year: any) => get('/api/pg/format-summary', { year }),
      itemSnapshot: (params?: any) => get('/api/pg/item-snapshot', params),
    },
  }
}
