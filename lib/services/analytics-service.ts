import { fetchItems, fetchDocuments, fetchDocumentDetail, fetchDashboard, fetchItemDetail, fetchBatchStock, fetchStock, searchDocuments, fetchAllStockItems, fetchBatchPrices, fetchAllCustomers, fetchItemHistory } from '../finansit-client'
import { getCached, setCache, deleteCache } from '../redis-client'
import { query as dbQuery } from '../db'
import { readQuery } from '../sqlite'
import { CACHE_TTL, DOC_FORMATS, MONTH_NAMES } from '../constants'
import type { DemandItem, SalesDataPoint, SeasonalDataPoint, DeadStockItem, ReorderItem, FinansitItem, DashboardData, TopSellingItem } from '../types'
import { fixRtlItemName } from '../rtl-fix'

// ── Dashboard KPIs ──

export async function getDashboardData(): Promise<DashboardData> {
  const cacheKey = 'dashboard:kpis'
  const cached = await getCached<DashboardData>(cacheKey)
  if (cached) return cached

  const data = await fetchDashboard()
  await setCache(cacheKey, data, CACHE_TTL.DASHBOARD)
  return data
}

// ── Helper: map raw API item to FinansitItem ──

function mapRawItem(raw: any): FinansitItem | null {
  if (!raw || !raw.code) return null
  return {
    code: raw.code,
    name: raw.name || raw.code,
    barcode: raw.barcode || '',
    group: raw.group || '',
    price: raw.price_list_price || raw.price || 0,
    in_stock: raw.stock_qty || raw.in_stock || 0,
    inquiry_count: raw.inquiry_count || 0,
    stock_qty: raw.stock_qty || 0,
    ordered_qty: raw.ordered_qty || 0,
    incoming_qty: raw.incoming_qty || 0,
    sold_this_year: raw.sold_this_year || 0,
    sold_last_year: raw.sold_last_year || 0,
    sold_2y_ago: raw.sold_2y_ago || 0,
    sold_3y_ago: raw.sold_3y_ago || 0,
    place: raw.place || '',
    category: raw.group || undefined,
    sale_date: raw.sale_date || undefined,
    purchase_date: raw.purchase_date || undefined,
    update_date: raw.update_date || undefined,
    count_date: raw.count_date || undefined,
    item_id_history: raw.item_id_history || undefined,
    new_item_id: raw.new_item_id || undefined,
    old_item_id: raw.old_item_id || undefined,
  }
}

// ── Chain Resolution (Union-Find) ──

function buildChainMap(items: FinansitItem[]): { items: FinansitItem[]; codeToCanonical: Map<string, string> } {
  // Union-Find structure
  const parent = new Map<string, string>()

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    // Path compression
    let curr = x
    while (curr !== root) {
      const next = parent.get(curr)!
      parent.set(curr, root)
      curr = next
    }
    return root
  }

  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  // Build unions from item_id_history chains
  for (const item of items) {
    if (item.item_id_history && item.item_id_history.length > 1) {
      for (let i = 1; i < item.item_id_history.length; i++) {
        union(item.item_id_history[i - 1], item.item_id_history[i])
      }
    }
    if (item.new_item_id) union(item.code, item.new_item_id)
    if (item.old_item_id) union(item.code, item.old_item_id)
  }

  // Group items by chain root
  const chains = new Map<string, FinansitItem[]>()
  for (const item of items) {
    const root = find(item.code)
    const chain = chains.get(root) || []
    chain.push(item)
    chains.set(root, chain)
  }

  const codeToCanonical = new Map<string, string>()
  const mergedItems: FinansitItem[] = []

  for (const [, chain] of chains) {
    if (chain.length === 1) {
      codeToCanonical.set(chain[0].code, chain[0].code)
      mergedItems.push(chain[0])
      continue
    }

    // Pick canonical: prefer new_item_id target, then most recent sale_date, then first with stock
    let canonical = chain[0]
    for (const item of chain) {
      // If any chain member is a new_item_id target, prefer it
      const isNewTarget = chain.some(other => other.new_item_id === item.code)
      const canonicalIsNewTarget = chain.some(other => other.new_item_id === canonical.code)
      if (isNewTarget && !canonicalIsNewTarget) {
        canonical = item
        continue
      }
      if (!isNewTarget && canonicalIsNewTarget) continue
      // Then prefer most recent sale_date
      if ((item.sale_date || '') > (canonical.sale_date || '')) {
        canonical = item
        continue
      }
      if ((item.sale_date || '') < (canonical.sale_date || '')) continue
      // Then first with stock
      if (item.stock_qty > 0 && canonical.stock_qty === 0) {
        canonical = item
      }
    }

    // Aggregate numerics into canonical
    const merged: FinansitItem = { ...canonical }
    const aliasCodes: string[] = []

    for (const item of chain) {
      if (item.code === canonical.code) continue
      aliasCodes.push(item.code)
      merged.stock_qty += item.stock_qty
      merged.ordered_qty += item.ordered_qty
      merged.incoming_qty += item.incoming_qty
      merged.sold_this_year += item.sold_this_year
      merged.sold_last_year += item.sold_last_year
      merged.sold_2y_ago += item.sold_2y_ago
      merged.sold_3y_ago += item.sold_3y_ago
      merged.inquiry_count += item.inquiry_count
      merged.in_stock += item.in_stock
      // Pick best (most recent) dates
      if ((item.sale_date || '') > (merged.sale_date || '')) merged.sale_date = item.sale_date
      if ((item.purchase_date || '') > (merged.purchase_date || '')) merged.purchase_date = item.purchase_date
      if ((item.update_date || '') > (merged.update_date || '')) merged.update_date = item.update_date
      if ((item.count_date || '') > (merged.count_date || '')) merged.count_date = item.count_date
    }

    // If canonical has a numeric/code name, try to find a better name from any chain member
    if (/^\d+$/.test(merged.name) || merged.name === merged.code) {
      const betterName = chain.find(
        i => i.code !== canonical.code && !/^\d+$/.test(i.name) && i.name !== i.code && i.name.length > 2
      )
      if (betterName) merged.name = betterName.name
    }

    merged.alias_codes = aliasCodes

    // Build ordered chain history: A → B → C via new_item_id pointers
    const inChain = new Set(chain.map(m => m.code))
    const nextMap = new Map<string, string>()
    for (const m of chain) {
      if (m.new_item_id && inChain.has(m.new_item_id)) nextMap.set(m.code, m.new_item_id)
    }
    const hasIncoming = new Set(nextMap.values())
    const starts = chain.filter(m => !hasIncoming.has(m.code))
    let chainHistory: string[] = []
    if (starts.length >= 1) {
      let cur = starts[0].code
      const visited = new Set<string>()
      while (cur && !visited.has(cur)) { chainHistory.push(cur); visited.add(cur); cur = nextMap.get(cur) ?? '' }
      for (const m of chain) { if (!visited.has(m.code)) chainHistory.push(m.code) }
    } else {
      chainHistory = [canonical.code, ...chain.filter(m => m.code !== canonical.code).map(m => m.code)]
    }
    merged.chain_history = chainHistory

    // Map all codes in chain to canonical
    codeToCanonical.set(canonical.code, canonical.code)
    for (const alias of aliasCodes) {
      codeToCanonical.set(alias, canonical.code)
    }

    mergedItems.push(merged)
  }

  return { items: mergedItems, codeToCanonical }
}

// Cached chain map
let cachedChainMap: Map<string, string> | null = null
let chainMapCacheTime = 0
const CHAIN_MAP_TTL = 300_000 // 5 minutes

async function getChainMap(): Promise<Map<string, string>> {
  if (cachedChainMap && Date.now() - chainMapCacheTime < CHAIN_MAP_TTL) {
    return cachedChainMap
  }
  // getItems() will populate the chain map as a side-effect
  await getItems()
  return cachedChainMap || new Map()
}

// ── Items with full enrichment ──

// In-flight deduplication: if getItems() is already running, reuse the same promise
let getItemsInflight: Promise<FinansitItem[]> | null = null

// In-memory cache fallback (for when Redis is unavailable)
// Set to null on startup to force fresh fetch after price-fix deployment
let inMemoryItemsCache: { data: FinansitItem[]; time: number } | null = null
const IN_MEMORY_FRESH_TTL = 30 * 60 * 1000  // 30 min
const IN_MEMORY_STALE_TTL = 6 * 60 * 60 * 1000  // 6 hours

export async function getItems(): Promise<FinansitItem[]> {
  const cacheKey = 'items:enriched:v12'
  const staleCacheKey = 'items:enriched:v11:stale'

  // Try Redis first
  const cached = await getCached<FinansitItem[]>(cacheKey)
  if (cached) return cached

  // Try in-memory fresh cache
  if (inMemoryItemsCache && Date.now() - inMemoryItemsCache.time < IN_MEMORY_FRESH_TTL) {
    return inMemoryItemsCache.data
  }

  // Stale-while-revalidate: return stale data immediately, refresh in background
  const stale = await getCached<FinansitItem[]>(staleCacheKey)
  const staleMemory = inMemoryItemsCache && Date.now() - inMemoryItemsCache.time < IN_MEMORY_STALE_TTL
    ? inMemoryItemsCache.data : null
  const staleData = stale || staleMemory

  if (staleData) {
    // Trigger background refresh (don't await)
    if (!getItemsInflight) {
      getItemsInflight = _getItemsImpl(cacheKey, staleCacheKey)
      getItemsInflight.finally(() => { getItemsInflight = null })
    }
    return staleData
  }

  // True cold start: no cache at all, must block
  if (getItemsInflight) return getItemsInflight

  getItemsInflight = _getItemsImpl(cacheKey, staleCacheKey)
  try {
    return await getItemsInflight
  } finally {
    getItemsInflight = null
  }
}

function mergeEnrichedIntoItem(item: FinansitItem, enriched: any): void {
  item.stock_qty = enriched.stock_qty ?? item.stock_qty
  item.ordered_qty = enriched.ordered_qty ?? item.ordered_qty
  item.incoming_qty = enriched.incoming_qty ?? item.incoming_qty
  item.sold_this_year = enriched.sold_this_year ?? item.sold_this_year
  item.sold_last_year = enriched.sold_last_year ?? item.sold_last_year
  item.sold_2y_ago = enriched.sold_2y_ago ?? item.sold_2y_ago
  item.sold_3y_ago = enriched.sold_3y_ago ?? item.sold_3y_ago
  item.in_stock = enriched.stock_qty ?? item.in_stock
  item.price = enriched.price_list_price || enriched.price || item.price
  if (enriched.sale_date) item.sale_date = enriched.sale_date
  if (enriched.purchase_date) item.purchase_date = enriched.purchase_date
  if (enriched.update_date) item.update_date = enriched.update_date
  if (enriched.count_date) item.count_date = enriched.count_date
  if (enriched.place) item.place = enriched.place
  if (enriched.item_id_history) item.item_id_history = enriched.item_id_history
  if (enriched.new_item_id) item.new_item_id = enriched.new_item_id
  if (enriched.old_item_id) item.old_item_id = enriched.old_item_id
}

async function _getItemsImpl(cacheKey: string, staleCacheKey?: string): Promise<FinansitItem[]> {
  const STALE_TTL = 6 * 60 * 60 // 6 hours

  // Strategy:
  // 1. fetchAllStockItems() HTTP call — FINAPI caches internally via its own Redis
  // 2. fetchItems() → full catalog (names, groups, chain info)
  // 3. Merge: catalog as base, overlay stock data on top

  const [stockItems, catalogItems] = await Promise.all([
    fetchAllStockItems().catch((e) => {
      console.warn('[Analytics] fetchAllStockItems failed:', e)
      return null
    }),
    // Catalog fetch with 30s timeout
    Promise.race([
      fetchItems(),
      new Promise<any[]>((resolve) => setTimeout(() => {
        console.warn('[Analytics] fetchItems timed out after 30s, proceeding without catalog')
        resolve([])
      }, 30000))
    ]).catch((e) => {
      console.warn('[Analytics] fetchItems failed:', e)
      return [] as any[]
    }),
  ])

  const effectiveStockItems = stockItems

  const catalogMap = new Map<string, any>()
  for (const raw of catalogItems) {
    if (raw.code) catalogMap.set(raw.code, raw)
  }

  // Reverse map: any old code in item_id_history / old_item_id → canonical catalog entry
  const historyToCatalog = new Map<string, any>()
  for (const [canonCode, catItem] of catalogMap) {
    if (catItem.item_id_history) {
      for (const oldCode of catItem.item_id_history) {
        if (oldCode !== canonCode) historyToCatalog.set(oldCode, catItem)
      }
    }
    if (catItem.old_item_id && catItem.old_item_id !== canonCode) {
      historyToCatalog.set(catItem.old_item_id, catItem)
    }
  }

  if (effectiveStockItems && effectiveStockItems.length > 0) {
    const items: FinansitItem[] = []

    for (const stock of effectiveStockItems) {
      const code = stock.item_code
      if (!code) continue
      const catalog = catalogMap.get(code) || historyToCatalog.get(code)

      const item: FinansitItem = {
        code,
        name: fixRtlItemName(stock.item_name || catalog?.name || code),
        barcode: catalog?.barcode || '',
        group: stock.group || catalog?.group || '',
        price: catalog?.price_list_price || catalog?.price || 0,
        in_stock: stock.total_qty || 0,
        inquiry_count: catalog?.inquiry_count || 0,
        stock_qty: stock.total_qty || 0,
        ordered_qty: stock.total_ordered || 0,
        incoming_qty: stock.total_incoming || 0,
        sold_this_year: stock.total_sold_this_year || 0,
        sold_last_year: stock.total_sold_last_year || 0,
        sold_2y_ago: stock.total_sold_2y_ago || 0,
        sold_3y_ago: stock.total_sold_3y_ago || 0,
        place: stock.place || '',
        category: stock.group || catalog?.group || undefined,
        sale_date: stock.sale_date || undefined,
        purchase_date: stock.purchase_date || undefined,
        update_date: stock.update_date || undefined,
        count_date: stock.count_date || undefined,
        item_id_history: catalog?.item_id_history || undefined,
        new_item_id: catalog?.new_item_id || undefined,
        old_item_id: catalog?.old_item_id || undefined,
      }
      items.push(item)
    }

    console.log(`[Analytics] Stock data: ${effectiveStockItems.length} items with stock, catalog: ${catalogItems.length}`)

    // Resolve names for items where item_name looks like a numeric code (barcode/alias)
    // Blocking — must complete before buildChainMap so inMemoryItemsCache is always correct
    const MAX_NAME_RESOLVE = 50
    const numericNameItems = items
      .filter(i => (/^\d+$/.test(i.name) && i.name !== i.code) || i.name === i.code)
      .slice(0, MAX_NAME_RESOLVE)
    if (numericNameItems.length > 0) {
      console.log(`[Analytics] Resolving ${numericNameItems.length} items with numeric/alias names via history API`)
      await Promise.allSettled(
        numericNameItems.map(async (item) => {
          try {
            const history = await fetchItemHistory(item.code)
            const description = history?.canonical_name
            if (description && !/^\d+$/.test(description)) item.name = fixRtlItemName(description)
          } catch {}
        })
      )
    }

    // Batch-fetch prices for items still at price=0 (catalog list doesn't include prices)
    const zeroPriceCodes = items.filter(i => i.price === 0 && i.stock_qty > 0).map(i => i.code)
    if (zeroPriceCodes.length > 0) {
      try {
        const priceCacheKey = 'items:prices:v3'
        let priceMap = await getCached<Record<string, number>>(priceCacheKey)
        if (!priceMap) {
          console.log(`[Analytics] Batch-fetching prices for ${zeroPriceCodes.length} items...`)
          priceMap = await fetchBatchPrices(zeroPriceCodes).catch(() => ({} as Record<string, number>))

          // Always fall back to SQLite item_snapshot for any remaining zero-price items
          const stillMissing = zeroPriceCodes.filter(c => !priceMap![c.toUpperCase()])
          if (stillMissing.length > 0) {
            try {
              // Query in batches to avoid SQLite variable limit
              const BATCH = 500
              for (let i = 0; i < stillMissing.length; i += BATCH) {
                const batch = stillMissing.slice(i, i + BATCH)
                const pgResult = readQuery(
                  `SELECT item_code, retail_price AS price
                   FROM item_snapshot
                   WHERE item_code IN (${batch.map(() => '?').join(',')}) AND retail_price > 0`,
                  batch
                )
                for (const row of pgResult.rows) {
                  priceMap![row.item_code.toUpperCase()] = parseFloat(row.price)
                }
              }
              console.log(`[Analytics] SQLite item_snapshot prices fallback: filled ${zeroPriceCodes.length - stillMissing.length + Object.keys(priceMap!).length} of ${zeroPriceCodes.length}`)
            } catch (e) {
              console.warn('[Analytics] SQLite prices fallback failed:', e)
            }
          }
          await setCache(priceCacheKey, priceMap, 12 * 60 * 60) // 12h TTL
          console.log(`[Analytics] Got prices for ${Object.keys(priceMap).length} items`)
        }
        for (const item of items) {
          if (item.price === 0 && priceMap[item.code.toUpperCase()]) {
            item.price = priceMap[item.code.toUpperCase()]
          }
        }
      } catch (e) {
        console.warn('[Analytics] Batch price fetch failed:', e)
      }
    }

    const resolved = buildChainMap(items)
    cachedChainMap = resolved.codeToCanonical
    chainMapCacheTime = Date.now()
    console.log(`[Analytics] Chain resolution: ${items.length} → ${resolved.items.length} items`)
    await setCache(cacheKey, resolved.items, CACHE_TTL.ITEMS)
    if (staleCacheKey) await setCache(staleCacheKey, resolved.items, STALE_TTL)
    inMemoryItemsCache = { data: resolved.items, time: Date.now() }
    return resolved.items
  }

  // Fallback: old invoice-discovery method if stock/all is unavailable
  console.warn('[Analytics] Falling back to invoice discovery method')
  const activeItemCodes = new Set<string>()
  try {
    const [invoices, quotes] = await Promise.all([
      fetchDocuments(DOC_FORMATS.TAX_INVOICE, 50),
      fetchDocuments(DOC_FORMATS.QUOTE, 20).catch(() => []),
    ])
    const allDocs = [
      ...invoices.map((d: any) => ({ format: 11, doc_number: d.doc_number })),
      ...quotes.map((d: any) => ({ format: 31, doc_number: d.doc_number })),
    ]
    for (let i = 0; i < allDocs.length; i += 10) {
      const batch = allDocs.slice(i, i + 10)
      const details = await Promise.all(
        batch.map(async (doc) => {
          try { return await fetchDocumentDetail(doc.format, doc.doc_number) } catch { return null }
        })
      )
      for (const detail of details) {
        if (!detail?.lines) continue
        for (const line of detail.lines) {
          if (line.item_code && line.item_code.length > 1) activeItemCodes.add(line.item_code)
        }
      }
    }
    console.log(`[Analytics] Discovered ${activeItemCodes.size} active items from ${invoices.length} invoices + ${quotes.length} quotes`)
  } catch (e) {
    console.warn('[Analytics] Invoice/quote discovery failed:', e)
  }

  const items: FinansitItem[] = []
  const activeCodes = [...activeItemCodes]
  for (let i = 0; i < activeCodes.length; i += 10) {
    const batch = activeCodes.slice(i, i + 10)
    const results = await Promise.all(
      batch.map(async (code) => {
        try { return await fetchItemDetail(code) } catch { return null }
      })
    )
    for (const raw of results) {
      const item = mapRawItem(raw)
      if (item) items.push(item)
    }
  }
  console.log(`[Analytics] Enriched ${items.length} items with stock/sales data`)

  const resolved = buildChainMap(items)
  cachedChainMap = resolved.codeToCanonical
  chainMapCacheTime = Date.now()
  console.log(`[Analytics] Chain resolution: ${items.length} → ${resolved.items.length} items`)
  await setCache(cacheKey, resolved.items, CACHE_TTL.ITEMS)
  if (staleCacheKey) await setCache(staleCacheKey, resolved.items, STALE_TTL)
  inMemoryItemsCache = { data: resolved.items, time: Date.now() }
  return resolved.items
}

// ── Demand Analysis ──

export async function getDemandAnalysis(dateFrom?: string, dateTo?: string): Promise<DemandItem[]> {
  const cacheKey = `analytics:demand:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = await getCached<DemandItem[]>(cacheKey)
  if (cached) return cached

  // Fetch quotes with Redis-first approach, then items in parallel
  const now = new Date()
  const activeYear = now.getFullYear()
  const default90d = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]
  const effDateFrom = dateFrom || default90d
  const effDateTo = dateTo || now.toISOString().split('T')[0]
  const fromYear = parseInt(effDateFrom.substring(0, 4), 10)
  const toYear = parseInt(effDateTo.substring(0, 4), 10)

  const items = await getItems()

  const itemMap = new Map(items.map(i => [i.code, i]))
  const chainMap = await getChainMap()
  const demandMap = new Map<string, { count: number; qty: number }>()

  // Fetch quotes via FINAPI HTTP API
  {
    let allQuotes: any[] = []
    for (let y = fromYear; y <= toYear; y++) {
      const yFrom = y === fromYear ? effDateFrom : `${y}-01-01`
      const yTo = y === toYear ? effDateTo : `${y}-12-31`
      const params: Record<string, string> = {
        format: String(DOC_FORMATS.QUOTE),
        date_from: yFrom,
        date_to: yTo,
        limit: '1000',
        direction: 'desc',
      }
      try {
        const yearQuotes = await searchDocuments(params)
        console.log(`[Analytics] Demand quotes ${y}: ${yearQuotes.length} (${yFrom} to ${yTo})`)
        allQuotes = allQuotes.concat(yearQuotes)
      } catch (e) {
        console.warn(`[Analytics] Demand quotes ${y} search failed, trying fetchDocuments:`, e)
        if (y === activeYear) {
          const fallback = await fetchDocuments(DOC_FORMATS.QUOTE, 500)
          allQuotes = allQuotes.concat(fallback.filter((q: any) => {
            const d = q.doc_date
            return d && d >= yFrom && d <= yTo
          }))
        }
      }
    }
    console.log(`[Analytics] Demand: ${allQuotes.length} total quotes from HTTP for ${effDateFrom} to ${effDateTo}`)

    // Fetch line items from quotes (up to 100, all batches concurrent)
    const recentQuotes = allQuotes.slice(0, 100)
    const BATCH_SIZE = 10
    const batches: any[][] = []
    for (let i = 0; i < recentQuotes.length; i += BATCH_SIZE) {
      batches.push(recentQuotes.slice(i, i + BATCH_SIZE))
    }
    const allDetails = await Promise.all(
      batches.map(batch =>
        Promise.all(batch.map(async (q: any) => {
          try { return await fetchDocumentDetail(31, q.doc_number) } catch { return null }
        }))
      )
    )
    for (const batchDetails of allDetails) {
      for (const detail of batchDetails) {
        if (!detail?.lines) continue
        for (const line of detail.lines) {
          const rawCode = line.item_code
          if (!rawCode || rawCode.length <= 1) continue
          const code = chainMap.get(rawCode) || rawCode
          const existing = demandMap.get(code) || { count: 0, qty: 0 }
          existing.count += 1
          existing.qty += line.quantity || 1
          demandMap.set(code, existing)
        }
      }
    }
  }

  const result: DemandItem[] = Array.from(demandMap.entries())
    .filter(([code]) => code.length > 1)
    .map(([code, data]) => {
      const item = itemMap.get(code)
      const daysSinceSale = item?.sale_date
        ? Math.floor((now.getTime() - new Date(item.sale_date).getTime()) / 86400000)
        : undefined
      return {
        code,
        name: item?.name || code,
        request_count: data.count,
        total_qty_requested: data.qty,
        stock_qty: item?.stock_qty || 0,
        price: item?.price || 0,
        sale_date: item?.sale_date,
        days_since_sale: daysSinceSale,
        alias_codes: item?.alias_codes,
      }
    })
    .sort((a, b) => b.request_count - a.request_count)

  await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
  return result
}

// ── Sales Analytics ──

export async function getSalesData(period: string = '30d', overrideDateFrom?: string, overrideDateTo?: string): Promise<SalesDataPoint[]> {
  const now = new Date()
  let dateFrom: string

  if (overrideDateFrom) {
    dateFrom = overrideDateFrom
  } else {
    switch (period) {
      case '7d': dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]; break
      case '30d': dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]; break
      case '90d': dateFrom = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]; break
      case 'ytd': dateFrom = `${now.getFullYear()}-01-01`; break
      case '1y': dateFrom = new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0]; break
      default: dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]
    }
  }

  const dateTo = overrideDateTo || now.toISOString().split('T')[0]

  // Try SQLite first (fast, local)
  try {
    const dbResult = readQuery(
      `SELECT date, revenue, invoice_count
       FROM daily_sales
       WHERE date >= ? AND date <= ?
       ORDER BY date`,
      [dateFrom, dateTo]
    )
    if (dbResult.rows.length > 0) {
      return dbResult.rows.map((r: any) => ({
        date: r.date,
        revenue: parseFloat(r.revenue) || 0,
        count: r.invoice_count || 0,
      }))
    }
  } catch (e: any) {
    console.warn('[Analytics] getSalesData SQLite query failed:', e?.message)
  }

  // Fallback: Neon PostgreSQL
  try {
    const pgResult = await dbQuery(
      `SELECT date::text as date, revenue, invoice_count
       FROM dashboard.daily_sales
       WHERE date >= $1 AND date <= $2
       ORDER BY date`,
      [dateFrom, dateTo]
    )
    if (pgResult.rows.length > 0) {
      return pgResult.rows.map((r: any) => ({
        date: r.date,
        revenue: parseFloat(r.revenue) || 0,
        count: r.invoice_count || 0,
      }))
    }
  } catch (e: any) {
    console.warn('[Analytics] getSalesData Neon fallback failed:', e?.message)
  }

  return []
}

// ── Seasonal Correlation ──

export async function getSeasonalData(dateFrom?: string, dateTo?: string): Promise<SeasonalDataPoint[]> {
  const cacheKey = `analytics:seasonal:v11:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = await getCached<SeasonalDataPoint[]>(cacheKey)
  if (cached) return cached

  // Strategy 1: PostgreSQL monthly_sales — fast, uses year/month columns directly
  try {
    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (dateFrom) {
      const fromYear = parseInt(dateFrom.substring(0, 4), 10)
      const fromMonth = parseInt(dateFrom.substring(5, 7), 10)
      conditions.push(`(year > $${paramIdx} OR (year = $${paramIdx} AND month >= $${paramIdx + 1}))`)
      params.push(fromYear, fromMonth)
      paramIdx += 2
    }
    if (dateTo) {
      const toYear = parseInt(dateTo.substring(0, 4), 10)
      const toMonth = parseInt(dateTo.substring(5, 7), 10)
      conditions.push(`(year < $${paramIdx} OR (year = $${paramIdx} AND month <= $${paramIdx + 1}))`)
      params.push(toYear, toMonth)
      paramIdx += 2
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Aggregate by month only — avoids bogus category from SPLIT_PART(item_name,' ',1)
    // Divide total by distinct year count so the value represents a typical month, not a sum over years
    const sqliteWhere = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ').replace(/\$\d+/g, '?')}`
      : ''
    const dbResult = readQuery(
      `SELECT
         month,
         SUM(revenue) AS total_revenue,
         COUNT(DISTINCT year) AS year_count
       FROM monthly_sales
       ${sqliteWhere}
       GROUP BY month
       HAVING SUM(revenue) > 0
       ORDER BY month`,
      params
    )

    if (dbResult.rows.length > 0) {
      // Check if data covers enough distinct years for meaningful seasonal analysis
      if (dateFrom && dateTo) {
        const requestedFromYear = parseInt(dateFrom.substring(0, 4), 10)
        const requestedToYear = parseInt(dateTo.substring(0, 4), 10)
        const requestedYears = requestedToYear - requestedFromYear + 1
        const distinctYears = Math.max(...dbResult.rows.map((r: any) => Number(r.year_count)), 0)
        if (requestedYears >= 2 && distinctYears < 2) {
          // Fall back to daily_sales aggregated by month — covers full history when monthly_sales is sparse
          const dailyResult = readQuery(`
            SELECT
              CAST(strftime('%Y', date) AS INTEGER) AS year,
              CAST(strftime('%m', date) AS INTEGER) AS month,
              SUM(revenue) AS total_revenue
            FROM daily_sales
            WHERE date >= ? AND date <= ?
            GROUP BY strftime('%Y', date), strftime('%m', date)
            ORDER BY year, month
          `, [dateFrom, dateTo])

          if (dailyResult.rows.length > 0) {
            // Aggregate by month across all years, averaging over distinct years
            const monthMap = new Map<number, { total: number; years: Set<number> }>()
            for (const r of dailyResult.rows) {
              const m = Number(r.month)
              const y = Number(r.year)
              const existing = monthMap.get(m) || { total: 0, years: new Set<number>() }
              existing.total += parseFloat(r.total_revenue) || 0
              existing.years.add(y)
              monthMap.set(m, existing)
            }
            const maxAvg = Math.max(...Array.from(monthMap.values()).map(v => v.total / Math.max(v.years.size, 1)), 1)
            const result: SeasonalDataPoint[] = Array.from(monthMap.entries())
              .sort(([a], [b]) => a - b)
              .map(([month, data]) => {
                const avgRevenue = data.total / Math.max(data.years.size, 1)
                return {
                  category: 'כל המכירות',
                  month,
                  month_name: MONTH_NAMES[month - 1] || 'Unknown',
                  avg_sales: avgRevenue,
                  intensity: avgRevenue / maxAvg,
                }
              })
            await setCache(cacheKey, result, CACHE_TTL.SEASONAL)
            console.log(`[Analytics] Seasonal from daily_sales fallback: ${result.length} data points`)
            return result
          }

          throw new Error('Insufficient year coverage in monthly_sales, falling back to FINAPI')
        }
      }

      // Supplement any months missing from monthly_sales with daily_sales data
      // (e.g., sync only ran during winter months — summer months would otherwise show as empty)
      const presentMonths = new Set(dbResult.rows.map((r: any) => Number(r.month)))
      if (presentMonths.size < 12) {
        try {
          const suppFrom = dateFrom || `${new Date().getFullYear() - 2}-01-01`
          const suppTo = dateTo || new Date().toISOString().split('T')[0]
          const dailySupp = readQuery(`
            SELECT
              CAST(strftime('%m', date) AS INTEGER) AS month,
              CAST(strftime('%Y', date) AS INTEGER) AS year,
              SUM(revenue) AS total_revenue
            FROM daily_sales
            WHERE date >= ? AND date <= ?
            GROUP BY strftime('%Y', date), strftime('%m', date)
            ORDER BY month, year
          `, [suppFrom, suppTo])

          const suppByMonth = new Map<number, { total: number; years: Set<number> }>()
          for (const r of dailySupp.rows) {
            const m = Number(r.month)
            if (presentMonths.has(m)) continue  // already covered by monthly_sales
            const existing = suppByMonth.get(m) || { total: 0, years: new Set<number>() }
            existing.total += parseFloat(r.total_revenue) || 0
            existing.years.add(Number(r.year))
            suppByMonth.set(m, existing)
          }

          for (const [month, data] of suppByMonth) {
            if (data.total > 0) {
              dbResult.rows.push({
                month: String(month),
                total_revenue: String(data.total),
                year_count: String(data.years.size),
              })
            }
          }
          if (suppByMonth.size > 0) {
            console.log(`[Analytics] Supplemented ${suppByMonth.size} missing months from daily_sales`)
          }
        } catch (e) {
          console.warn('[Analytics] Month supplement from daily_sales failed:', e)
        }

        // Also try app PostgreSQL daily_sales for still-missing months
        const presentMonthsAfterSupp = new Set([
          ...presentMonths,
          ...Array.from(dbResult.rows.map((r: any) => Number(r.month))),
        ])
        if (presentMonthsAfterSupp.size < 12) {
          try {
            const suppFrom = dateFrom || `${new Date().getFullYear() - 2}-01-01`
            const suppTo = dateTo || new Date().toISOString().split('T')[0]
            const pgSupp = await dbQuery(`
              SELECT EXTRACT(MONTH FROM date)::int AS month,
                     EXTRACT(YEAR FROM date)::int AS year,
                     SUM(revenue) AS total_revenue
              FROM dashboard.daily_sales
              WHERE date >= $1 AND date <= $2
              GROUP BY 1, 2
              ORDER BY 1, 2
            `, [suppFrom, suppTo])
            const pgSuppByMonth = new Map<number, { total: number; years: Set<number> }>()
            for (const r of pgSupp.rows) {
              const m = Number(r.month)
              if (presentMonthsAfterSupp.has(m)) continue
              const existing = pgSuppByMonth.get(m) || { total: 0, years: new Set<number>() }
              existing.total += parseFloat(r.total_revenue) || 0
              existing.years.add(Number(r.year))
              pgSuppByMonth.set(m, existing)
            }
            for (const [month, data] of pgSuppByMonth) {
              if (data.total > 0) {
                dbResult.rows.push({
                  month: String(month),
                  total_revenue: String(data.total),
                  year_count: String(data.years.size),
                })
              }
            }
            if (pgSuppByMonth.size > 0) {
              console.log(`[Analytics] Supplemented ${pgSuppByMonth.size} missing months from app PostgreSQL daily_sales`)
            }
          } catch (e) { /* ignore */ }
        }
      }

      const averagedRows = dbResult.rows.map((r: any) => ({
        month: r.month,
        avg_revenue: parseFloat(r.total_revenue) / Math.max(Number(r.year_count), 1),
      }))
      const maxSales = Math.max(...averagedRows.map((r: any) => r.avg_revenue), 1)
      const result: SeasonalDataPoint[] = averagedRows.map((r: any) => ({
        category: 'כל המכירות',
        month: r.month,
        month_name: MONTH_NAMES[r.month - 1] || 'Unknown',
        avg_sales: r.avg_revenue,
        intensity: r.avg_revenue / maxSales,
      }))

      await setCache(cacheKey, result, CACHE_TTL.SEASONAL)
      console.log(`[Analytics] Seasonal from PostgreSQL: ${result.length} data points`)
      return result
    }
  } catch (e: any) {
    const msg = e?.message || ''
    if (msg.includes('does not exist') || msg.includes('relation')) {
      console.warn('[Analytics] monthly_sales table does not exist yet, falling back to items')
    } else {
      console.warn('[Analytics] PostgreSQL seasonal query failed, falling back:', msg)
    }
  }

  // Strategy 1.5: App PostgreSQL daily_sales — between SQLite and FINAPI HTTP
  try {
    const effFrom = dateFrom || `${new Date().getFullYear() - 2}-01-01`
    const effTo = dateTo || new Date().toISOString().split('T')[0]
    const pgDaily = await dbQuery(`
      SELECT
        EXTRACT(MONTH FROM date)::int AS month,
        SUM(revenue) AS total_revenue,
        COUNT(DISTINCT EXTRACT(YEAR FROM date)::int) AS year_count
      FROM dashboard.daily_sales
      WHERE date >= $1 AND date <= $2 AND revenue > 0
      GROUP BY 1
      HAVING SUM(revenue) > 0
      ORDER BY 1
    `, [effFrom, effTo])

    if (pgDaily.rows.length > 0) {
      const averagedRows = pgDaily.rows.map((r: any) => ({
        month: Number(r.month),
        avg_revenue: parseFloat(r.total_revenue) / Math.max(Number(r.year_count), 1),
      }))
      const maxSales = Math.max(...averagedRows.map((r: any) => r.avg_revenue), 1)
      const result: SeasonalDataPoint[] = averagedRows.map((r: any) => ({
        category: 'כל המכירות',
        month: r.month,
        month_name: MONTH_NAMES[r.month - 1] || 'Unknown',
        avg_sales: r.avg_revenue,
        intensity: r.avg_revenue / maxSales,
      }))
      await setCache(cacheKey, result, CACHE_TTL.SEASONAL)
      console.log(`[Analytics] Seasonal from app PostgreSQL daily_sales: ${result.length} months`)
      return result
    }
  } catch (pgErr) {
    console.warn('[Analytics] App PostgreSQL daily_sales fallback failed:', pgErr)
  }

  // Strategy 2: FINAPI HTTP — one request per year, aggregate doc_date by month
  try {
    const now = new Date()
    const activeYear = now.getFullYear()
    const effDateFrom = dateFrom || `${activeYear - 1}-01-01`
    const effDateTo = dateTo || now.toISOString().split('T')[0]
    const rawFromYear = parseInt(effDateFrom.substring(0, 4), 10)
    const fromYear = Math.max(rawFromYear, activeYear - 3)
    const toYear = parseInt(effDateTo.substring(0, 4), 10)

    const monthlyRevenue = new Map<number, { total: number; years: Set<number> }>()

    // One request per year (not per month) — aggregate by month client-side from doc_date
    // Try with year param first; if 0 results, retry without year param (some FINAPI versions auto-route by date)
    const yearResults = await Promise.all(
      Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i).map(async (y) => {
        const yFrom = y === fromYear ? effDateFrom : `${y}-01-01`
        const yTo = y === toYear ? effDateTo : `${y}-12-31`
        const baseParams: Record<string, string> = {
          format: String(DOC_FORMATS.TAX_INVOICE),
          date_from: yFrom,
          date_to: yTo,
          limit: '10000',
          direction: 'desc',
        }
        try {
          // Try without year param first (works for active year and avoids 0-result bug for historical years)
          const invoices = await searchDocuments(baseParams)
          console.log(`[Analytics] Seasonal FINAPI year ${y}: ${invoices.length} invoices`)
          // If 0 results for historical year, retry with year param as fallback
          if (invoices.length === 0 && y !== activeYear) {
            const invoicesWithYear = await searchDocuments({ ...baseParams, year: String(y) })
            console.log(`[Analytics] Seasonal FINAPI year ${y}: ${invoicesWithYear.length} invoices (with year param retry)`)
            return invoicesWithYear
          }
          return invoices
        } catch (e) {
          console.warn(`[Analytics] Seasonal FINAPI year ${y} failed:`, e)
          return []
        }
      })
    )

    for (const invoices of yearResults) {
      for (const inv of invoices) {
        const dateStr: string = inv.doc_date || ''
        if (!dateStr) continue
        const month = parseInt(dateStr.substring(5, 7), 10)
        if (month < 1 || month > 12) continue
        const year = parseInt(dateStr.substring(0, 4), 10)
        const val = inv.grand_total || inv.total || 0
        const existing = monthlyRevenue.get(month) || { total: 0, years: new Set<number>() }
        existing.total += val
        existing.years.add(year)
        monthlyRevenue.set(month, existing)
      }
    }

    if (monthlyRevenue.size > 0) {
      const averagedEntries = Array.from(monthlyRevenue.entries()).map(([month, data]) => ({
        month,
        avg_revenue: data.total / Math.max(data.years.size, 1),
      }))
      const maxSales = Math.max(...averagedEntries.map(e => e.avg_revenue), 1)
      const result: SeasonalDataPoint[] = []
      for (const { month, avg_revenue } of averagedEntries) {
        if (avg_revenue <= 0) continue
        result.push({
          category: 'כל המכירות',
          month,
          month_name: MONTH_NAMES[month - 1] || 'Unknown',
          avg_sales: avg_revenue,
          intensity: avg_revenue / maxSales,
        })
      }
      result.sort((a, b) => a.month - b.month)
      await setCache(cacheKey, result, CACHE_TTL.SEASONAL)
      console.log(`[Analytics] Seasonal: ${result.length} months`)
      return result
    }
  } catch (e) {
    console.warn('[Analytics] FINAPI seasonal failed:', e)
  }

  // Strategy 3: Items with sale_date (last resort fallback)
  try {
    const items = await getItems()
    const catMonthMap = new Map<string, { total: number; count: number }>()

    for (const item of items) {
      const totalSales = item.sold_this_year + item.sold_last_year
      if (totalSales === 0) continue

      const saleDate = item.sale_date || item.purchase_date
      if (!saleDate) continue

      if (dateFrom && saleDate < dateFrom) continue
      if (dateTo && saleDate > dateTo) continue

      const month = parseInt(saleDate.substring(5, 7), 10)
      if (month < 1 || month > 12) continue

      const category = item.category || item.group || 'Other'
      if (category.length <= 1) continue

      const key = `${category}|${month}`
      const existing = catMonthMap.get(key) || { total: 0, count: 0 }
      existing.total += totalSales * item.price
      existing.count += 1
      catMonthMap.set(key, existing)
    }

    if (catMonthMap.size > 0) {
      const maxSales = Math.max(...[...catMonthMap.values()].map(v => v.total), 1)
      const categoryTotals = new Map<string, number>()
      for (const [key, data] of catMonthMap) {
        const category = key.split('|')[0]
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + data.total)
      }
      const topCategories = [...categoryTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([cat]) => cat)

      const result: SeasonalDataPoint[] = []
      for (const [key, data] of catMonthMap) {
        const [category, monthStr] = key.split('|')
        if (!topCategories.includes(category)) continue
        const month = parseInt(monthStr, 10)
        result.push({
          category,
          month,
          month_name: MONTH_NAMES[month - 1] || 'Unknown',
          avg_sales: data.total,
          intensity: data.total / maxSales,
        })
      }

      result.sort((a, b) => a.category.localeCompare(b.category) || a.month - b.month)
      await setCache(cacheKey, result, CACHE_TTL.SEASONAL)
      return result
    }
  } catch (e) {
    console.warn('[Analytics] Items seasonal failed:', e)
  }

  console.warn('[Analytics] No seasonal data available')
  return []
}

// ── Dead Stock ──

export async function getDeadStock(yearsThreshold: number = 1): Promise<DeadStockItem[]> {
  const cacheKey = `analytics:dead-stock:${yearsThreshold}`
  const cached = await getCached<DeadStockItem[]>(cacheKey)
  if (cached) return cached

  const items = await getItems()
  const now = new Date()
  const currentYear = now.getFullYear()

  const deadStock: DeadStockItem[] = items
    .filter(item => {
      if (item.stock_qty <= 0) return false
      if (yearsThreshold === 1) return item.sold_this_year === 0 && item.sold_last_year === 0
      if (yearsThreshold === 2) return item.sold_this_year === 0 && item.sold_last_year === 0 && item.sold_2y_ago === 0
      return item.sold_this_year === 0 && item.sold_last_year === 0 && item.sold_2y_ago === 0 && item.sold_3y_ago === 0
    })
    .map(item => {
      // Use sale_date for accurate last-sold info when available
      let lastSoldYear = 0
      if (item.sale_date) {
        lastSoldYear = parseInt(item.sale_date.substring(0, 4), 10) || 0
      } else {
        if (item.sold_this_year > 0) lastSoldYear = currentYear
        else if (item.sold_last_year > 0) lastSoldYear = currentYear - 1
        else if (item.sold_2y_ago > 0) lastSoldYear = currentYear - 2
        else if (item.sold_3y_ago > 0) lastSoldYear = currentYear - 3
      }

      const daysSinceSale = item.sale_date
        ? Math.floor((now.getTime() - new Date(item.sale_date).getTime()) / 86400000)
        : undefined
      const daysSinceCount = item.count_date
        ? Math.floor((now.getTime() - new Date(item.count_date).getTime()) / 86400000)
        : undefined

      return {
        code: item.code,
        name: item.name,
        stock_qty: item.stock_qty,
        price: item.price,
        capital_tied: item.stock_qty * item.price,
        last_sold_year: lastSoldYear,
        years_dead: lastSoldYear > 0 ? currentYear - lastSoldYear : 4,
        category: item.category,
        sale_date: item.sale_date,
        count_date: item.count_date,
        purchase_date: item.purchase_date,
        days_since_sale: daysSinceSale,
        days_since_count: daysSinceCount,
        alias_codes: item.alias_codes,
      }
    })
    .sort((a, b) => b.capital_tied - a.capital_tied)

  await setCache(cacheKey, deadStock, CACHE_TTL.ANALYTICS)
  return deadStock
}

// ── Reorder Recommendations ──

export async function getReorderRecommendations(dateFrom?: string, dateTo?: string): Promise<ReorderItem[]> {
  const cacheKey = `analytics:reorder:v2:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = await getCached<ReorderItem[]>(cacheKey)
  if (cached) return cached

  const items = await getItems()
  const now = new Date()

  // Note: dateFrom/dateTo are accepted but not used to filter items because
  // sold_this_year, sold_last_year, inquiry_count are pre-aggregated annual
  // totals from Finansit — filtering by sale_date would just remove items
  // whose last sale falls outside the range, not filter actual sales data.
  const currentMonth = now.getMonth() + 1
  const summerMonths = [5, 6, 7, 8, 9, 10]

  const reorderItems: ReorderItem[] = items
    .filter(item =>
      item.inquiry_count > 0 ||
      item.sold_this_year > 0 ||
      item.sold_last_year > 0 ||
      (item.stock_qty > 0 && (item.sold_2y_ago > 0 || item.sold_3y_ago > 0))
    )
    .map(item => {
      const incomingQty = item.incoming_qty || 0
      const orderedQty = item.ordered_qty || 0
      // effectiveQty = on-hand + arriving + on-order (all supply pipeline)
      const effectiveQty = item.stock_qty + incomingQty + orderedQty

      // Boost urgency for items with recent sale_date (trending)
      const daysSinceSale = item.sale_date
        ? Math.floor((now.getTime() - new Date(item.sale_date).getTime()) / 86400000)
        : 365
      const recencyBoost = daysSinceSale < 30 ? 1.5 : daysSinceSale < 90 ? 1.2 : 1.0

      const urgencyScore = ((item.inquiry_count * 3 + item.sold_this_year * 2) /
        Math.max(effectiveQty, 1)) * recencyBoost

      const demandVelocity = Math.min(item.sold_this_year / Math.max(item.sold_last_year, 1), 2)
      const stockCoverage = effectiveQty / Math.max(item.sold_this_year / 12, 1)
      const customerBreadth = Math.min(item.inquiry_count / 10, 1)

      // Dynamic seasonal relevance from sale_date month vs current season
      let seasonalRelevance = 0.5
      if (item.sale_date) {
        const saleMonth = parseInt(item.sale_date.substring(5, 7), 10)
        const itemIsSummer = summerMonths.includes(saleMonth)
        const nowIsSummer = summerMonths.includes(currentMonth)
        // Higher relevance if item's season matches current season
        seasonalRelevance = itemIsSummer === nowIsSummer ? 0.9 : 0.2
        // Extra boost if we're approaching the item's peak season (within 2 months)
        const monthDiff = Math.abs(saleMonth - currentMonth)
        if (monthDiff <= 2 || monthDiff >= 10) seasonalRelevance = Math.min(seasonalRelevance + 0.2, 1.0)
      }

      // Supplier freshness from update_date
      const daysSinceUpdate = item.update_date
        ? Math.floor((now.getTime() - new Date(item.update_date).getTime()) / 86400000)
        : undefined
      const supplierFreshness = daysSinceUpdate !== undefined
        ? Math.max(0, Math.min(1, 1 - daysSinceUpdate / 365))
        : 0.5

      // Recommended order quantity: enough for 3 months, minus full supply pipeline
      const bestAnnualSales = Math.max(item.sold_this_year, item.sold_last_year, 1)
      const monthlyVelocity = bestAnnualSales / 12
      const targetStock = Math.ceil(monthlyVelocity * 3)
      const recommendedQty = Math.max(0, targetStock - effectiveQty)

      return {
        code: item.code,
        name: item.name,
        stock_qty: item.stock_qty,
        incoming_qty: incomingQty,
        ordered_qty: orderedQty,
        inquiry_count: Math.round(item.inquiry_count),
        sold_this_year: Math.round(item.sold_this_year),
        sold_last_year: Math.round(item.sold_last_year),
        price: item.price,
        urgency_score: Math.round(urgencyScore * 100) / 100,
        demand_velocity: Math.round(demandVelocity * 100) / 100,
        stock_coverage: Math.round(stockCoverage * 10) / 10,
        seasonal_relevance: Math.round(seasonalRelevance * 100) / 100,
        customer_breadth: Math.round(customerBreadth * 100) / 100,
        sale_date: item.sale_date,
        purchase_date: item.purchase_date,
        days_since_sale: daysSinceSale,
        supplier_freshness: Math.round(supplierFreshness * 100) / 100,
        alias_codes: item.alias_codes,
        recommended_qty: recommendedQty,
      }
    })
    .sort((a, b) => b.urgency_score - a.urgency_score)
    .slice(0, 500)

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

  // Strategy 1: PostgreSQL monthly_sales — fast, no API calls
  try {
    const fromYear = parseInt(dateFrom.substring(0, 4), 10)
    const fromMonth = parseInt(dateFrom.substring(5, 7), 10)
    const toYear = now.getFullYear()
    const toMonth = now.getMonth() + 1

    const dbResult = readQuery(
      `SELECT item_code, item_name,
              SUM(quantity) AS total_qty,
              SUM(revenue) AS total_revenue,
              SUM(invoice_count) AS total_count
       FROM monthly_sales
       WHERE (year > ? OR (year = ? AND month >= ?))
         AND (year < ? OR (year = ? AND month <= ?))
       GROUP BY item_code, item_name
       HAVING SUM(revenue) > 0
       ORDER BY total_revenue DESC
       LIMIT 50`,
      [fromYear, fromYear, fromMonth, toYear, toYear, toMonth]
    )

    if (dbResult.rows.length > 0) {
      const items = await getItems()
      const itemMap = new Map(items.map(i => [i.code, i]))

      const result: TopSellingItem[] = dbResult.rows.map((r: any) => {
        const item = itemMap.get(r.item_code)
        const soldThisYear = item?.sold_this_year || 0
        const soldLastYear = item?.sold_last_year || 0
        let trend: 'rising' | 'falling' | 'stable' = 'stable'
        if (soldLastYear > 0) {
          const ratio = soldThisYear / soldLastYear
          if (ratio > 1.2) trend = 'rising'
          else if (ratio < 0.8) trend = 'falling'
        } else if (soldThisYear > 0) {
          trend = 'rising'
        }
        return {
          code: r.item_code,
          name: r.item_name || r.item_code,
          total_qty_sold: Math.round(parseFloat(r.total_qty) || 0),
          total_revenue: Math.round(parseFloat(r.total_revenue) || 0),
          invoice_count: r.total_count || 0,
          avg_price: parseFloat(r.total_qty) > 0 ? Math.round(parseFloat(r.total_revenue) / parseFloat(r.total_qty)) : 0,
          stock_qty: item?.stock_qty || 0,
          sale_date: item?.sale_date,
          trend,
          alias_codes: item?.alias_codes,
        }
      }).slice(0, 20)

      await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
      console.log(`[Analytics] Top selling items from PostgreSQL: ${result.length} items`)
      return result
    }
  } catch (e: any) {
    const msg = e?.message || ''
    if (!msg.includes('does not exist') && !msg.includes('relation')) {
      console.warn('[Analytics] Top items DB query failed:', msg)
    }
  }

  // Fallback: fetch recent invoices via HTTP (capped at 200 to avoid timeout)
  try {
    const chainMap = await getChainMap()
    const allInvoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 200)
    const invoices = allInvoices.filter((inv: any) => {
      const d = inv.doc_date
      return d && d >= dateFrom && d <= now.toISOString().split('T')[0]
    })

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
          const code = chainMap.get(line.item_code) || line.item_code
          const existing = itemSales.get(code) || { name: line.item_name || code, qty: 0, revenue: 0, count: 0 }
          existing.qty += line.quantity || 0
          existing.revenue += line.line_total || 0
          existing.count += 1
          if (line.item_name) existing.name = line.item_name
          itemSales.set(code, existing)
        }
      }
    }

    const items = await getItems()
    const itemMap = new Map(items.map(i => [i.code, i]))

    const result: TopSellingItem[] = Array.from(itemSales.entries())
      .map(([code, data]) => {
        const item = itemMap.get(code)
        const soldThisYear = item?.sold_this_year || 0
        const soldLastYear = item?.sold_last_year || 0
        let trend: 'rising' | 'falling' | 'stable' = 'stable'
        if (soldLastYear > 0) {
          const ratio = soldThisYear / soldLastYear
          if (ratio > 1.2) trend = 'rising'
          else if (ratio < 0.8) trend = 'falling'
        } else if (soldThisYear > 0) {
          trend = 'rising'
        }
        return {
          code,
          name: data.name,
          total_qty_sold: Math.round(data.qty),
          total_revenue: Math.round(data.revenue),
          invoice_count: data.count,
          avg_price: data.qty > 0 ? Math.round(data.revenue / data.qty) : 0,
          stock_qty: item?.stock_qty || 0,
          sale_date: item?.sale_date,
          trend,
          alias_codes: item?.alias_codes,
        }
      })
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 20)

    await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
    return result
  } catch (e) {
    console.error('[Analytics] Top selling items failed:', e)
    return []
  }
}

// ── Customer Name Map ──

let customerMapCache: Map<string, string> | null = null
let customerMapCacheTime = 0
const CUSTOMER_MAP_TTL = 6 * 60 * 60 * 1000 // 6 hours

async function getCustomerNameMap(): Promise<Map<string, string>> {
  if (customerMapCache && Date.now() - customerMapCacheTime < CUSTOMER_MAP_TTL) {
    return customerMapCache
  }
  try {
    const redisCacheKey = 'customers:name-map:v1'
    const cached = await getCached<Record<string, string>>(redisCacheKey)
    if (cached) {
      customerMapCache = new Map(Object.entries(cached))
      customerMapCacheTime = Date.now()
      return customerMapCache
    }
    const customers = await fetchAllCustomers()
    const map = new Map<string, string>()
    for (const c of customers) {
      const code = c.code || c.customer_code
      const name = c.name || c.customer_name
      if (code && name) map.set(String(code), name)
    }
    console.log(`[Analytics] Loaded ${map.size} customer names from API`)
    await setCache(redisCacheKey, Object.fromEntries(map), 6 * 60 * 60)
    customerMapCache = map
    customerMapCacheTime = Date.now()
    return map
  } catch (e) {
    console.warn('[Analytics] Failed to fetch customer names:', e)
    return customerMapCache || new Map()
  }
}

// ── Quote-to-Invoice Conversion Analysis ──

export async function getConversionAnalysis(dateFrom?: string, dateTo?: string) {
  const cacheKey = `analytics:conversion:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = await getCached<any>(cacheKey)
  if (cached) return cached

  const now = new Date()
  const activeYear = now.getFullYear()
  const default90d = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]
  const effDateFrom = dateFrom || default90d
  const effDateTo = dateTo || now.toISOString().split('T')[0]
  const fromYear = parseInt(effDateFrom.substring(0, 4), 10)
  const toYear = parseInt(effDateTo.substring(0, 4), 10)

  // Parse documents helper — FINAPI HTTP only
  // fetchLines=true: also fetch line item details (quotes only); false: skip (invoices)
  async function fetchDocs(format: number, fetchLines = false): Promise<Array<{doc_number: string; doc_date: string; customer_code: string; customer_name: string; grand_total: number; lines: Array<{item_code: string; item_name: string; quantity: number; line_total: number}>}>> {
    const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i)

    // Fetch all years in parallel
    const yearResults = await Promise.all(years.map(async (y) => {
      const yFrom = y === fromYear ? effDateFrom : `${y}-01-01`
      const yTo = y === toYear ? effDateTo : `${y}-12-31`
      const params: Record<string, string> = {
        format: String(format),
        date_from: yFrom,
        date_to: yTo,
        limit: '1000',
        direction: 'desc',
      }
      if (y !== activeYear) params.year = String(y)
      try {
        return await searchDocuments(params)
      } catch {
        return []
      }
    }))

    const docs = yearResults.flat().map((r: any) => ({
      doc_number: r.doc_number,
      doc_date: r.doc_date || '',
      customer_code: r.customer_code || '',
      customer_name: r.customer_name || '',
      grand_total: r.grand_total || 0,
      lines: [] as any[],
    }))

    if (!fetchLines) return docs  // invoices: skip line items entirely

    // Quotes: fetch line details for up to 30 docs, all batches concurrent
    const toFetch = docs.slice(0, 30)
    const batchCount = Math.ceil(toFetch.length / 10)
    const allDetails = await Promise.all(
      Array.from({ length: batchCount }, (_, i) =>
        Promise.all(
          toFetch.slice(i * 10, (i + 1) * 10).map(async (d: any) => {
            try { return await fetchDocumentDetail(format, d.doc_number) } catch { return null }
          })
        )
      )
    )
    for (const detail of allDetails.flat()) {
      if (!detail?.lines) continue
      const doc = docs.find((d: any) => d.doc_number === detail.doc_number)
      if (doc) doc.lines = detail.lines
    }

    return docs
  }

  const [quotes, invoices, customerNames] = await Promise.all([
    fetchDocs(DOC_FORMATS.QUOTE, true),
    fetchDocs(DOC_FORMATS.TAX_INVOICE, false),
    getCustomerNameMap(),
  ])

  // Build invoice lookup: customerCode -> set of invoice dates (customer-level, no line items needed)
  const invoiceLookup = new Map<string, string[]>() // customerCode -> [doc_dates]
  for (const inv of invoices) {
    if (!inv.customer_code) continue
    const existing = invoiceLookup.get(inv.customer_code) || []
    existing.push(inv.doc_date)
    invoiceLookup.set(inv.customer_code, existing)
  }

  let totalQuotedValue = 0
  let totalConvertedValue = 0
  let totalQuoteLines = 0
  let convertedLines = 0
  let totalDaysToConvert = 0
  let convertedWithDays = 0

  // Track per-item and per-customer stats
  const itemStats = new Map<string, { name: string; timesQuoted: number; timesSold: number; lostValue: number; lastQuoted: string }>()
  const customerStats = new Map<string, { name: string; quotesCount: number; convertedCount: number; totalQuoted: number; totalConverted: number }>()

  for (const quote of quotes) {
    const custKey = quote.customer_code
    if (!customerStats.has(custKey)) {
      const resolvedName = customerNames.get(custKey) || quote.customer_name || custKey
      customerStats.set(custKey, { name: resolvedName, quotesCount: 0, convertedCount: 0, totalQuoted: 0, totalConverted: 0 })
    }
    const cust = customerStats.get(custKey)!
    cust.quotesCount++
    cust.totalQuoted += quote.grand_total

    for (const line of quote.lines) {
      if (!line.item_code || line.item_code.length <= 1) continue
      totalQuoteLines++
      const lineValue = line.line_total || (line.quantity || 0) * (line as any).unit_price || 0
      totalQuotedValue += lineValue

      // Check conversion: did this customer invoice within 90 days of the quote? (customer-level, faster)
      const custInvoiceDates = invoiceLookup.get(quote.customer_code)
      let converted = false
      if (custInvoiceDates) {
        const quoteTime = new Date(quote.doc_date).getTime()
        for (const invDateStr of custInvoiceDates) {
          const invTime = new Date(invDateStr).getTime()
          const daysDiff = (invTime - quoteTime) / 86400000
          if (daysDiff >= 0 && daysDiff <= 90) {
            converted = true
            convertedLines++
            totalConvertedValue += lineValue
            totalDaysToConvert += daysDiff
            convertedWithDays++
            break
          }
        }
      }

      // Item stats
      if (!itemStats.has(line.item_code)) {
        itemStats.set(line.item_code, { code: line.item_code, name: line.item_name || line.item_code, timesQuoted: 0, timesSold: 0, lostValue: 0, lastQuoted: '' })
      }
      const item = itemStats.get(line.item_code)!
      item.timesQuoted++
      if (converted) {
        item.timesSold++
      } else {
        item.lostValue += lineValue
      }
      if (quote.doc_date > item.lastQuoted) item.lastQuoted = quote.doc_date

      if (converted) {
        cust.convertedCount++
        cust.totalConverted += lineValue
      }
    }
  }

  const conversionRate = totalQuoteLines > 0 ? Math.round((convertedLines / totalQuoteLines) * 100) : 0
  const lostRevenue = totalQuotedValue - totalConvertedValue
  const avgDaysToConvert = convertedWithDays > 0 ? Math.round(totalDaysToConvert / convertedWithDays) : 0

  const unconvertedItems = Array.from(itemStats.values())
    .filter(i => i.lostValue > 0)
    .sort((a, b) => b.lostValue - a.lostValue)
    .slice(0, 50)

  const customerConversions = Array.from(customerStats.values())
    .filter(c => c.quotesCount > 0)
    .map(c => ({
      ...c,
      rate: c.quotesCount > 0 ? Math.round((c.convertedCount / c.quotesCount) * 100) : 0,
      lostValue: c.totalQuoted - c.totalConverted,
    }))
    .sort((a, b) => b.lostValue - a.lostValue)

  const unconvertedCustomers = customerConversions
    .filter(c => c.rate < 50)
    .slice(0, 20)

  const result = {
    conversion_rate: conversionRate,
    total_quoted: Math.round(totalQuotedValue),
    total_converted: Math.round(totalConvertedValue),
    lost_revenue: Math.round(lostRevenue),
    avg_days_to_convert: avgDaysToConvert,
    total_quotes: quotes.length,
    total_quote_lines: totalQuoteLines,
    converted_lines: convertedLines,
    unconverted_items: unconvertedItems,
    unconverted_customers: unconvertedCustomers,
    customer_conversions: customerConversions,
  }

  await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
  return result
}

// ── ABC Classification ──

export async function getABCClassification(dateFrom?: string, dateTo?: string) {
  const cacheKey = `analytics:abc:v4:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = await getCached<any>(cacheKey)
  if (cached) return cached

  const now = new Date()
  const activeYear = now.getFullYear()
  const effDateFrom = dateFrom || `${activeYear}-01-01`
  const effDateTo = dateTo || now.toISOString().split('T')[0]
  const fromYear = parseInt(effDateFrom.substring(0, 4), 10)
  const fromMonth = parseInt(effDateFrom.substring(5, 7), 10)
  const toYear = parseInt(effDateTo.substring(0, 4), 10)
  const toMonth = parseInt(effDateTo.substring(5, 7), 10)
  const fromYYYYMM = fromYear * 100 + fromMonth
  const toYYYYMM = toYear * 100 + toMonth

  const items = await getItems()

  // Query monthly_sales for date-range revenue
  let revenueByCode = new Map<string, number>()
  try {
    const salesResult = readQuery(
      `SELECT item_code, SUM(revenue) AS total_revenue
       FROM monthly_sales
       WHERE (year * 100 + month) >= ?
         AND (year * 100 + month) <= ?
       GROUP BY item_code`,
      [fromYYYYMM, toYYYYMM]
    )
    for (const row of salesResult.rows) {
      revenueByCode.set(row.item_code as string, parseFloat(row.total_revenue) || 0)
    }
  } catch (e: any) {
    console.warn('[ABC] monthly_sales query failed, falling back to snapshot:', e?.message)
    revenueByCode = new Map()
  }

  // Calculate revenue per item
  const itemsWithRevenue = items
    .map(i => {
      const soldYr = i.sold_this_year || 0
      const soldLy = i.sold_last_year || 0
      const price = i.price || 0

      // Sum revenue across canonical + all alias codes from monthly_sales
      let revenue = revenueByCode.get(i.code) || 0
      for (const alias of (i.alias_codes || [])) {
        revenue += revenueByCode.get(alias) || 0
      }
      // Fallback to snapshot if no DB revenue data
      if (revenue === 0) {
        revenue = price > 0
          ? soldYr * price
          : (soldYr + soldLy * 0.5)
      }

      return {
        code: i.code,
        name: i.name,
        revenue,
        stock_qty: i.stock_qty || 0,
        price,
        capital_tied: (i.stock_qty || 0) * price,
        sold_this_year: soldYr,
        sold_last_year: soldLy,
        sale_date: i.sale_date,
        alias_codes: i.alias_codes,
      }
    })
    .filter(i => i.revenue > 0 || i.stock_qty > 0)
    .sort((a, b) => b.revenue - a.revenue)

  const totalRevenue = itemsWithRevenue.reduce((sum, i) => sum + i.revenue, 0)

  // Assign ABC class
  let cumulative = 0
  const classifiedItems = itemsWithRevenue.map(item => {
    cumulative += item.revenue
    const cumulativePct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 100
    const revenuePct = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0
    let abc_class: 'A' | 'B' | 'C'
    if (cumulativePct <= 80) abc_class = 'A'
    else if (cumulativePct <= 95) abc_class = 'B'
    else abc_class = 'C'

    const monthlyDemand = item.sold_this_year / 12
    const daysOfSupply = monthlyDemand > 0 ? Math.round((item.stock_qty / monthlyDemand) * 30) : item.stock_qty > 0 ? 999 : 0

    return {
      ...item,
      abc_class,
      days_of_supply: daysOfSupply,
      revenue_pct: Math.round(revenuePct * 100) / 100,       // e.g. 3.45 (%)
      cumulative_pct: Math.round(cumulativePct * 10) / 10,   // e.g. 67.2 (%)
    }
  })

  const aItems = classifiedItems.filter(i => i.abc_class === 'A')
  const bItems = classifiedItems.filter(i => i.abc_class === 'B')
  const cItems = classifiedItems.filter(i => i.abc_class === 'C')

  const aRevenue = aItems.reduce((s, i) => s + i.revenue, 0)
  const bRevenue = bItems.reduce((s, i) => s + i.revenue, 0)
  const cRevenue = cItems.reduce((s, i) => s + i.revenue, 0)

  const aCapital = aItems.reduce((s, i) => s + i.capital_tied, 0)
  const bCapital = bItems.reduce((s, i) => s + i.capital_tied, 0)
  const cCapital = cItems.reduce((s, i) => s + i.capital_tied, 0)

  // A-items at risk: low stock relative to monthly demand
  const aItemsAtRisk = aItems
    .filter(i => {
      const monthlyDemand = i.sold_this_year / 12
      return monthlyDemand > 0 && i.stock_qty < monthlyDemand
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 30)

  // C-items overstock: in stock but barely selling
  const cItemsOverstock = cItems
    .filter(i => i.stock_qty > 0 && i.capital_tied > 0)
    .sort((a, b) => b.capital_tied - a.capital_tied)
    .slice(0, 30)

  const result = {
    summary: {
      a_count: aItems.length,
      b_count: bItems.length,
      c_count: cItems.length,
      total_items: classifiedItems.length,
      a_revenue_pct: totalRevenue > 0 ? Math.round((aRevenue / totalRevenue) * 100) : 0,
      b_revenue_pct: totalRevenue > 0 ? Math.round((bRevenue / totalRevenue) * 100) : 0,
      c_revenue_pct: totalRevenue > 0 ? Math.round((cRevenue / totalRevenue) * 100) : 0,
      total_revenue: Math.round(totalRevenue),
    },
    capital_by_class: {
      a_capital: Math.round(aCapital),
      b_capital: Math.round(bCapital),
      c_capital: Math.round(cCapital),
      total_capital: Math.round(aCapital + bCapital + cCapital),
    },
    a_items_at_risk: aItemsAtRisk,
    c_items_overstock: cItemsOverstock,
    items: classifiedItems,
  }

  await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
  return result
}

// ── Customer Analytics ──

export async function getCustomerAnalytics(dateFrom?: string, dateTo?: string) {
  const cacheKey = `analytics:customers:v6:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = await getCached<any>(cacheKey)
  if (cached) return cached

  const now = new Date()
  const activeYear = now.getFullYear()
  const effDateFrom = dateFrom || `${activeYear}-01-01`
  const effDateTo = dateTo || now.toISOString().split('T')[0]
  const fromYear = parseInt(effDateFrom.substring(0, 4), 10)
  const toYear = parseInt(effDateTo.substring(0, 4), 10)

  // Also fetch last year for churn/trend detection
  const lastYearFrom = `${activeYear - 1}-01-01`
  const lastYearTo = `${activeYear - 1}-12-31`

  interface InvoiceRecord {
    doc_date: string
    customer_code: string
    customer_name: string
    grand_total: number
    lines: Array<{ item_code: string }>
    is_credit?: boolean
    _invoice_count?: number // override for synthetic PG-aggregated records
  }

  const allInvoices: InvoiceRecord[] = []

  // Historical years (2020–activeYear-1): query customer_stats from PostgreSQL in one call
  // Only include a year in the PG shortcut if it is FULLY covered by the date range
  const pgFromYear = effDateFrom <= `${fromYear}-01-01` ? fromYear : fromYear + 1
  const pgToYear = effDateTo >= `${toYear}-12-31` ? toYear : toYear - 1
  const histFromYear = Math.max(pgFromYear, 2020)
  const histToYear = Math.min(pgToYear, activeYear - 1)
  if (histFromYear <= histToYear) {
    try {
      const pgResult = readQuery(
        `SELECT customer_code, customer_name,
                year, total_revenue, invoice_count,
                last_invoice
         FROM customer_stats
         WHERE year BETWEEN ? AND ?`,
        [histFromYear, histToYear]
      )
      // Expand each per-year aggregate row into a single synthetic invoice record.
      // Use totalRevenue (not avgPerDoc) so the aggregation produces correct totals.
      // _invoice_count overrides the default +1 increment in the aggregation loop.
      for (const row of pgResult.rows) {
        const invoiceCount = Number(row.invoice_count) || 0
        if (invoiceCount === 0) continue
        const totalRevenue = Number(row.total_revenue) || 0
        const docDate = (row.last_invoice as string) || `${row.year}-12-31`
        allInvoices.push({
          doc_date: docDate,
          customer_code: row.customer_code as string,
          customer_name: (row.customer_name as string) || (row.customer_code as string),
          grand_total: totalRevenue,
          lines: [],
          _invoice_count: invoiceCount,
        })
      }
      console.log(`[Analytics] customer_stats SQLite: ${pgResult.rows.length} rows for years ${histFromYear}-${histToYear}`)
    } catch (e: any) {
      console.warn('[Analytics] customer_stats query failed, falling back to API for historical years:', e?.message)
      // Fallback: fetch historical years via FINAPI REST
      // Try with year param first; if 0 results, retry without (FINAPI may auto-route by date)
      for (let y = histFromYear; y <= histToYear; y++) {
        const yFrom = y === fromYear ? effDateFrom : `${y}-01-01`
        const yTo = y === toYear ? effDateTo : `${y}-12-31`
        try {
          let results = await searchDocuments({
            format: String(DOC_FORMATS.TAX_INVOICE),
            date_from: yFrom, date_to: yTo,
            limit: '5000', direction: 'desc',
            year: String(y),
          })
          if (results.length === 0) {
            results = await searchDocuments({
              format: String(DOC_FORMATS.TAX_INVOICE),
              date_from: yFrom, date_to: yTo,
              limit: '5000', direction: 'desc',
            })
          }
          console.log(`[Analytics] Customer history year ${y}: ${results.length} invoices`)
          for (const r of results) {
            const grand_total = r.grand_total || 0
            allInvoices.push({
              doc_date: r.doc_date || '',
              customer_code: r.customer_code || '',
              customer_name: r.customer_name || '',
              grand_total: grand_total < 0 ? -grand_total : grand_total,
              lines: [],
              is_credit: grand_total < 0,
            })
          }
          // Fetch credit invoices (format 12) for this year
          const credits = await searchDocuments({
            format: String(DOC_FORMATS.CREDIT_INVOICE),
            date_from: yFrom, date_to: yTo,
            limit: '5000', direction: 'desc',
            year: String(y),
          })
          for (const r of credits) {
            allInvoices.push({
              doc_date: r.doc_date || '',
              customer_code: r.customer_code || '',
              customer_name: r.customer_name || '',
              grand_total: Math.abs(r.grand_total || 0),
              lines: [],
              is_credit: true,
            })
          }
        } catch {}
      }
    }
  }

  // Partial historical years: years in [fromYear, toYear] that are historical (< activeYear)
  // but were excluded from the PG shortcut because they are only partially covered.
  const partialHistStart = Math.max(fromYear, 2020)
  const partialHistEnd = Math.min(toYear, activeYear - 1)
  for (let y = partialHistStart; y <= partialHistEnd; y++) {
    if (y >= histFromYear && y <= histToYear) continue // already fetched via PG
    const yFrom = y === fromYear ? effDateFrom : `${y}-01-01`
    const yTo = y === toYear ? effDateTo : `${y}-12-31`
    try {
      let results = await searchDocuments({
        format: String(DOC_FORMATS.TAX_INVOICE),
        date_from: yFrom, date_to: yTo,
        limit: '5000', direction: 'desc',
        year: String(y),
      })
      if (results.length === 0) {
        results = await searchDocuments({
          format: String(DOC_FORMATS.TAX_INVOICE),
          date_from: yFrom, date_to: yTo,
          limit: '5000', direction: 'desc',
        })
      }
      console.log(`[Analytics] Customer partial year ${y} (${yFrom}–${yTo}): ${results.length} invoices`)
      for (const r of results) {
        const grand_total = r.grand_total || 0
        allInvoices.push({
          doc_date: r.doc_date || '',
          customer_code: r.customer_code || '',
          customer_name: r.customer_name || '',
          grand_total: grand_total < 0 ? -grand_total : grand_total,
          lines: [],
          is_credit: grand_total < 0,
        })
      }
      const credits = await searchDocuments({
        format: String(DOC_FORMATS.CREDIT_INVOICE),
        date_from: yFrom, date_to: yTo,
        limit: '5000', direction: 'desc',
        year: String(y),
      })
      for (const r of credits) {
        allInvoices.push({
          doc_date: r.doc_date || '',
          customer_code: r.customer_code || '',
          customer_name: r.customer_name || '',
          grand_total: Math.abs(r.grand_total || 0),
          lines: [],
          is_credit: true,
        })
      }
    } catch {}
  }

  // Active year: always fetch live from FINAPI REST
  if (toYear >= activeYear) {
    const yFrom = fromYear === activeYear ? effDateFrom : `${activeYear}-01-01`
    const yTo = effDateTo
    try {
      const [results, credits] = await Promise.all([
        searchDocuments({
          format: String(DOC_FORMATS.TAX_INVOICE),
          date_from: yFrom, date_to: yTo,
          limit: '5000', direction: 'desc',
        }),
        searchDocuments({
          format: String(DOC_FORMATS.CREDIT_INVOICE),
          date_from: yFrom, date_to: yTo,
          limit: '5000', direction: 'desc',
        }),
      ])
      for (const r of results) {
        const grand_total = r.grand_total || 0
        allInvoices.push({
          doc_date: r.doc_date || '',
          customer_code: r.customer_code || '',
          customer_name: r.customer_name || '',
          grand_total: grand_total < 0 ? -grand_total : grand_total,
          lines: [],
          is_credit: grand_total < 0,
        })
      }
      for (const r of credits) {
        allInvoices.push({
          doc_date: r.doc_date || '',
          customer_code: r.customer_code || '',
          customer_name: r.customer_name || '',
          grand_total: Math.abs(r.grand_total || 0),
          lines: [],
          is_credit: true,
        })
      }
    } catch {}

    // If FINAPI returned nothing for the active year, fall back to PostgreSQL
    const activeYearInvoiceCount = allInvoices.filter(inv => !inv.is_credit && inv.doc_date >= (fromYear === activeYear ? effDateFrom : `${activeYear}-01-01`)).length
    if (activeYearInvoiceCount === 0) {
      const yFrom = fromYear === activeYear ? effDateFrom : `${activeYear}-01-01`
      const yTo = effDateTo
      try {
        const docsResult = readQuery(
          `SELECT customer_code, MAX(customer_name) AS customer_name,
                  SUM(grand_total) AS total_revenue, COUNT(*) AS invoice_count
           FROM documents
           WHERE format = '11' AND doc_date >= ? AND doc_date <= ?
             AND customer_code IS NOT NULL AND grand_total > 0
           GROUP BY customer_code`,
          [yFrom, yTo]
        )
        for (const row of docsResult.rows) {
          allInvoices.push({
            doc_date: yTo,
            customer_code: row.customer_code,
            customer_name: row.customer_name || row.customer_code,
            grand_total: parseFloat(row.total_revenue) || 0,
            lines: [],
            _invoice_count: parseInt(row.invoice_count, 10),
          } as any)
        }
        console.log(`[Analytics] Customers: PostgreSQL documents fallback: ${docsResult.rows.length} customers`)
      } catch (e) {
        console.warn('[Analytics] Customers PostgreSQL fallback failed:', e)
      }
    }
  }

  // Load customer names from API for enrichment
  const customerNames = await getCustomerNameMap().catch(() => new Map<string, string>())

  // Aggregate by customer
  const customerMap = new Map<string, {
    name: string
    gross_invoices: number
    total_credits: number
    total_revenue: number
    invoice_count: number
    first_purchase: string
    last_purchase: string
    this_year_revenue: number
    last_year_revenue: number
    unique_items: Set<string>
  }>()

  const thisYearStart = `${activeYear}-01-01`
  const lastYearStart = `${activeYear - 1}-01-01`
  const lastYearEnd = `${activeYear - 1}-12-31`

  for (const inv of allInvoices) {
    if (!inv.customer_code) continue
    if (!customerMap.has(inv.customer_code)) {
      const resolvedName = customerNames.get(inv.customer_code) || inv.customer_name || inv.customer_code
      customerMap.set(inv.customer_code, {
        name: resolvedName,
        gross_invoices: 0,
        total_credits: 0,
        total_revenue: 0,
        invoice_count: 0,
        first_purchase: inv.doc_date,
        last_purchase: inv.doc_date,
        this_year_revenue: 0,
        last_year_revenue: 0,
        unique_items: new Set(),
      })
    }
    const cust = customerMap.get(inv.customer_code)!
    const amount = inv.is_credit ? -inv.grand_total : inv.grand_total
    if (inv.is_credit) {
      cust.total_credits += inv.grand_total
    } else {
      cust.gross_invoices += inv.grand_total
      cust.invoice_count += inv._invoice_count ?? 1
    }
    cust.total_revenue += amount
    if (inv.doc_date && inv.doc_date < cust.first_purchase) cust.first_purchase = inv.doc_date
    if (inv.doc_date && inv.doc_date > cust.last_purchase) cust.last_purchase = inv.doc_date
    if (inv.doc_date >= thisYearStart) cust.this_year_revenue += amount
    if (inv.doc_date >= lastYearStart && inv.doc_date <= lastYearEnd) cust.last_year_revenue += amount
    for (const line of inv.lines) {
      if (line.item_code) cust.unique_items.add(line.item_code)
    }
  }

  const customers = Array.from(customerMap.entries())
    .map(([code, data]) => {
      let trend: 'up' | 'down' | 'stable' = 'stable'
      if (data.last_year_revenue > 0) {
        const ratio = data.this_year_revenue / data.last_year_revenue
        if (ratio > 1.2) trend = 'up'
        else if (ratio < 0.8) trend = 'down'
      } else if (data.this_year_revenue > 0) {
        trend = 'up'
      }
      return {
        code,
        name: data.name,
        gross_invoices: Math.round(data.gross_invoices),
        total_credits: Math.round(data.total_credits),
        total_revenue: Math.round(data.total_revenue),
        invoice_count: data.invoice_count,
        avg_order_value: data.invoice_count > 0 ? Math.round(data.gross_invoices / data.invoice_count) : 0,
        first_purchase: data.first_purchase,
        last_purchase: data.last_purchase,
        this_year_revenue: Math.round(data.this_year_revenue),
        last_year_revenue: Math.round(data.last_year_revenue),
        unique_items: data.unique_items.size,
        trend,
      }
    })
    .sort((a, b) => b.total_revenue - a.total_revenue)

  // Churned customers: bought last year, not this year
  const churned = customers
    .filter(c => c.last_year_revenue > 0 && c.this_year_revenue === 0)
    .sort((a, b) => b.last_year_revenue - a.last_year_revenue)

  // Concentration
  const totalRevenue = customers.reduce((s, c) => s + c.total_revenue, 0)
  const top5Revenue = customers.slice(0, 5).reduce((s, c) => s + c.total_revenue, 0)
  const top10Revenue = customers.slice(0, 10).reduce((s, c) => s + c.total_revenue, 0)
  // HHI index
  const hhi = totalRevenue > 0
    ? Math.round(customers.reduce((s, c) => s + Math.pow((c.total_revenue / totalRevenue) * 100, 2), 0))
    : 0

  const activeThisYear = customers.filter(c => c.this_year_revenue > 0).length
  const avgOrderValue = customers.length > 0
    ? Math.round(customers.reduce((s, c) => s + c.avg_order_value, 0) / customers.length)
    : 0

  const result = {
    customers,
    churned,
    concentration: {
      top5_pct: totalRevenue > 0 ? Math.round((top5Revenue / totalRevenue) * 100) : 0,
      top10_pct: totalRevenue > 0 ? Math.round((top10Revenue / totalRevenue) * 100) : 0,
      hhi_index: hhi,
    },
    summary: {
      total_customers: customers.length,
      active_this_year: activeThisYear,
      churned_count: churned.length,
      avg_order_value: avgOrderValue,
      total_revenue: Math.round(totalRevenue),
    },
  }

  await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
  return result
}
