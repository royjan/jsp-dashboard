import { client, fetchItems, fetchItemsBatch, fetchDocuments, fetchRecentDocumentDetails, fetchDocumentDetailsByNumber, fetchBatchStock, searchDocuments, fetchAllStockItems, fetchAllItemChainLinks, fetchBatchPrices, fetchAllCustomers, refreshCache, fetchRecommendationReport } from '../finansit-client'
import { getCached, setCache, deleteCache } from '../redis-client'
import { query as dbQuery } from '../db'
import { readQueryAsync } from '../neon-read'
import { CACHE_TTL, CACHE_VERSIONS, DOC_FORMATS, MONTH_NAMES } from '../constants'
import type { DemandItem, SalesDataPoint, SeasonalDataPoint, DeadStockItem, ReorderItem, FinansitItem, DashboardData, TopSellingItem } from '../types'
import { fixRtlItemName } from '../rtl-fix'

// ── Dashboard KPIs ──

export async function getDashboardData(forceRefresh = false): Promise<DashboardData> {
  const cacheKey = 'dashboard:kpis'
  const cached = forceRefresh ? null : await getCached<DashboardData>(cacheKey)
  if (cached) return cached

  const data = await client.dashboard.get()
  await setCache(cacheKey, data, CACHE_TTL.DASHBOARD)
  return data
}

/**
 * Simple catalog aggregates (number of items, total stock quantity), pre-warmed
 * daily into `dashboard:summary` by the cache-warmer lambda. Reading this avoids
 * the heavy live `getItems()` catalog fetch just to show a count. Returns null
 * when the key hasn't been warmed yet (cold cache) — callers can fall back to
 * deriving counts from `getItems()` if they truly need a live value.
 */
export interface DashboardSummary {
  total_items: number
  total_stock_qty: number
  timestamp?: string
}

export async function getDashboardSummary(): Promise<DashboardSummary | null> {
  return await getCached<DashboardSummary>('dashboard:summary')
}

// ── Helper: map raw API item to FinansitItem ──

/**
 * True when a "name" is really a code/barcode rather than a description.
 *
 * A plain /^\d+$/ test is too strict: the ERP also returns things like
 * "0829193289    #####" (item 1574JK) and "424983" — anything without a run of
 * two or more Hebrew/Latin letters carries no meaning for a human reader, and
 * is worth re-resolving from the per-item endpoint.
 */
export function looksLikeCodeNotName(name: string | null | undefined, code?: string): boolean {
  const n = (name || '').trim()
  if (!n) return true
  if (code && n === code) return true
  return !/[A-Za-z֐-׿]{2}/.test(n)
}

/**
 * Resolve real, human-readable names for many item codes in as few FINAPI calls
 * as possible.
 *
 * Returns a Map of code → name for the codes it could name; a code it could not
 * name is simply absent, so callers keep whatever they were showing.
 *
 * Three tiers, each one batch wider than the last:
 *   1. `POST /api/items/batch` — the authoritative short name, the same field
 *      the /items/[code] page renders. One call per 100 codes.
 *   2. For codes whose own name still looks like a code, one more batch over
 *      their `item_id_history` siblings: the ERP re-codes a part repeatedly and
 *      usually only one code in the chain carries the real description. This
 *      replaces the per-item `getHistory().canonical_name` call that used to run
 *      here — same intent (name from the chain), 1 call instead of N.
 *   3. Codes the item endpoint doesn't know AT ALL (aliases, quote-only codes)
 *      have no batch form — `/history` is the only thing that can name them, so
 *      those stay one call each, bounded and capped.
 */
const MAX_HISTORY_FALLBACK = 100

export async function resolveItemNames(codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set((codes || []).map(c => String(c || '').trim().toUpperCase()).filter(Boolean))]
  if (!wanted.length) return out

  const primary = await fetchItemsBatch(wanted)
  const chainCandidates = new Map<string, string[]>() // code → sibling codes worth trying
  const unknown: string[] = [] // FINAPI has no item at all for these

  for (const code of wanted) {
    const item = primary.get(code)
    if (!item) { unknown.push(code); continue }
    const name = item.name
    if (name && !looksLikeCodeNotName(name, code)) { out.set(code, fixRtlItemName(name)); continue }
    const siblings: string[] = (item.item_id_history || [])
      .map((c: any) => String(c || '').trim().toUpperCase())
      .filter((c: string) => c && c !== code)
    if (siblings.length) chainCandidates.set(code, siblings)
  }

  if (chainCandidates.size > 0) {
    const siblingItems = await fetchItemsBatch([...new Set([...chainCandidates.values()].flat())])
    for (const [code, siblings] of chainCandidates) {
      for (const sib of siblings) {
        const n = siblingItems.get(sib)?.name
        if (n && !looksLikeCodeNotName(n, code) && !looksLikeCodeNotName(n, sib)) {
          out.set(code, fixRtlItemName(n))
          break
        }
      }
    }
  }

  if (unknown.length > 0) {
    const queue = unknown.slice(0, MAX_HISTORY_FALLBACK)
    if (unknown.length > queue.length) {
      console.log(`[Analytics] resolveItemNames: ${unknown.length - queue.length} unknown codes left unnamed (history fallback capped at ${MAX_HISTORY_FALLBACK})`)
    }
    const worker = async () => {
      for (let code = queue.shift(); code; code = queue.shift()) {
        try {
          const canonical = (await client.items.getHistory(code))?.canonical_name
          if (canonical && !looksLikeCodeNotName(canonical, code)) out.set(code, fixRtlItemName(canonical))
        } catch { /* leave it unnamed */ }
      }
    }
    await Promise.allSettled(Array.from({ length: 4 }, worker))
  }

  return out
}

export const NO_CATEGORY = 'ללא קטגוריה'

/**
 * The item's category — which, for this catalogue, is almost always "we don't have one".
 *
 * Measured against the live FINAPI on 2026-08-16 over a 500-item sample: `categories` was
 * null on every single item, and `group` — the only other candidate — was the placeholder
 * '0000' on 317, empty on 163, and 'NNNN'/'PPPP'/'0001'/'0002' on the remaining 20. So the
 * ERP does not carry a meaningful per-item category at all.
 *
 * That matters because three analytics routes group their entire output by this field. They
 * used to read it from dashboard.item_snapshots, where it is the EMPTY STRING on 2,664 of
 * 2,668 rows — and since COALESCE only replaces NULL, every one of those charts was really a
 * single unnamed bucket. Pointing them at the live catalogue does NOT fix that; it would just
 * relabel the bucket '0000', which is worse, because a placeholder that looks like data gets
 * believed.
 *
 * So placeholders are named honestly here, in one place, and the charts show one truthful
 * category instead of a fabricated breakdown. Giving those pages a real dimension needs
 * category data that does not exist yet — a data decision, not a code change.
 */
export function itemCategory(item: { category?: string; group?: string } | undefined | null): string {
  const raw = (item?.category || item?.group || '').trim()
  if (!raw) return NO_CATEGORY
  // Placeholder group codes: all-zero, or a repeated single letter ('NNNN', 'PPPP').
  if (/^0+$/.test(raw) || /^([A-Za-z])\1+$/.test(raw)) return NO_CATEGORY
  return raw
}

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

// ── Full-catalog chain links ──
//
// Chain links (new_item_id / old_item_id) come from the catalog fetch, but
// fetchItems() is capped at 10k of ~113k items, so most of the catalog never
// contributed links and buildChainMap left those chains unmerged: the old code
// kept its own shelf qty (often 0 — a false critical on /stock-forecast) while
// the successor row held the real stock (e.g. 1647880280 → 1695249780). The
// full link set (~24k rows) streams from /api/stream/items in ~70s, so it is
// fetched in the background, kept in Redis for a week and refreshed daily;
// request paths only ever read the cache.

type ChainLink = { code: string; new_item_id?: string; old_item_id?: string }

const CHAIN_LINKS_CACHE_KEY = 'items:chain-links:v1'
const CHAIN_LINKS_REDIS_TTL = 7 * 24 * 60 * 60 // survives FINAPI outages/redeploys
const CHAIN_LINKS_REFRESH_MS = 24 * 60 * 60 * 1000 // supersessions change rarely

let inMemoryChainLinks: { links: ChainLink[]; fetchedAt: number } | null = null
let chainLinksRefreshInflight: Promise<void> | null = null

function refreshChainLinksInBackground(): void {
  if (chainLinksRefreshInflight) return
  chainLinksRefreshInflight = (async () => {
    const t0 = Date.now()
    const links = await fetchAllItemChainLinks()
    // A tiny result is a degraded/truncated stream, not "no chains exist" —
    // keep the previous set rather than unmerging the whole catalog.
    if (links.length < 1000) {
      console.warn(`[Analytics] chain-links stream returned only ${links.length} rows — keeping previous set`)
      return
    }
    const payload = { links, fetchedAt: Date.now() }
    inMemoryChainLinks = payload
    await setCache(CHAIN_LINKS_CACHE_KEY, payload, CHAIN_LINKS_REDIS_TTL)
    console.log(`[Analytics] chain links refreshed: ${links.length} links in ${Date.now() - t0}ms`)
    // The current items snapshot may have been built before these links were
    // available — age it into the stale zone so the next request rebuilds
    // (stale-while-revalidate) with fully merged chains.
    if (inMemoryItemsCache) {
      inMemoryItemsCache.time = Math.min(inMemoryItemsCache.time, Date.now() - IN_MEMORY_FRESH_TTL)
    }
  })().catch((e) => {
    console.warn('[Analytics] chain-links refresh failed:', e)
  }).finally(() => { chainLinksRefreshInflight = null })
}

/**
 * Cached full-catalog chain links. Kicks a background refresh when missing or
 * older than a day and NEVER blocks on the 70s stream — a true cold start
 * (empty Redis) returns [] once, which degrades to the old 10k-window behavior
 * until the background fetch lands.
 */
async function getChainLinks(): Promise<ChainLink[]> {
  if (!inMemoryChainLinks) {
    const cached = await getCached<{ links: ChainLink[]; fetchedAt: number }>(CHAIN_LINKS_CACHE_KEY)
    if (cached?.links?.length) inMemoryChainLinks = cached
  }
  if (!inMemoryChainLinks || Date.now() - inMemoryChainLinks.fetchedAt > CHAIN_LINKS_REFRESH_MS) {
    refreshChainLinksInBackground()
  }
  return inMemoryChainLinks?.links ?? []
}

// ── Chain Resolution (Union-Find) ──

// Finansit has placeholder "items" for freight/service invoice lines ('0', '000',
// '+', '7777' — "משלוח / מונית" etc.) that carry supersession links into real
// parts (000.new_item_id → 1612434080) and serve as the old_item_id root of the
// whole placeholder family. Unioning through them fused unrelated parts into one
// chain, inflating merged stock and demand on /stock-forecast. A supersession
// link where either endpoint looks like a placeholder is never a real chain.
export function isPlaceholderCode(code: string): boolean {
  const c = (code || '').trim()
  if (c.length < 4) return true            // '0', '000', '+'
  if (/^(.)\1+$/.test(c)) return true      // '7777', '0000'
  if (!/[a-zA-Z0-9]/.test(c)) return true  // pure punctuation
  return false
}

function buildChainMap(items: FinansitItem[], extraLinks: ChainLink[] = []): { items: FinansitItem[]; codeToCanonical: Map<string, string> } {
  // Backfill link fields the truncated catalog window didn't supply — both the
  // unions below and the canonical pick ("prefer the new_item_id target")
  // depend on them being present on the item.
  if (extraLinks.length > 0) {
    const linkByCode = new Map(extraLinks.map(l => [l.code, l]))
    for (const item of items) {
      const link = linkByCode.get(item.code)
      if (!link) continue
      if (!item.new_item_id && link.new_item_id) item.new_item_id = link.new_item_id
      if (!item.old_item_id && link.old_item_id) item.old_item_id = link.old_item_id
    }
  }

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
    if (isPlaceholderCode(a) || isPlaceholderCode(b)) return
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
    if (looksLikeCodeNotName(merged.name, merged.code)) {
      const betterName = chain.find(
        i => i.code !== canonical.code && !looksLikeCodeNotName(i.name, i.code) && i.name.length > 2
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

export async function getChainMap(): Promise<Map<string, string>> {
  if (cachedChainMap && Date.now() - chainMapCacheTime < CHAIN_MAP_TTL) {
    return cachedChainMap
  }
  // getItems() will populate the chain map as a side-effect
  await getItems()
  return cachedChainMap || new Map()
}

// ── Chain-aware aggregation helpers ──
//
// getItems() returns ONE row per supersession chain, keyed by the canonical
// code. Every other store — monthly_sales, document_lines, yearly_item_sales,
// ebay_price_compare, competitor_items — is keyed by the RAW code the document
// was written against. Joining the two without folding is the single most
// repeated bug in this file's callers: an alias's sales silently vanish (the
// lookup misses) and one physical part ranks as two, so 18 of the top-20
// selling items understated their revenue and the order scrambled.
//
// Use ONE of these two, never a bare `map.get(item.code)`:
//   · getCanonicalizer() — fold raw-code rows UP to the canonical code
//   · chainCodesOf(item) — fan an item DOWN to every code to look up

/**
 * Every ERP code belonging to an item's chain: the canonical code plus every
 * alias the merge folded into it. Sum raw-code lookups over all of these.
 */
export function chainCodesOf(item: {
  code: string
  alias_codes?: string[] | null
  chain_history?: string[] | null
  item_id_history?: string[] | null
}): string[] {
  const out = new Set<string>()
  for (const c of [
    item.code,
    ...(item.alias_codes || []),
    ...(item.chain_history || []),
    ...(item.item_id_history || []),
  ]) {
    const s = String(c ?? '').trim()
    if (s) out.add(s)
  }
  return [...out]
}

/**
 * A raw-code → canonical-code resolver. Tolerant of case and padding, because
 * the document tables are not as tidy as the item master. Unknown codes map to
 * themselves, so a cold/degraded chain map degrades to today's behaviour rather
 * than collapsing unrelated parts together.
 */
export async function getCanonicalizer(): Promise<(code: string) => string> {
  const map = await getChainMap()
  return (code: string) => {
    const raw = String(code ?? '').trim()
    if (!raw) return raw
    return map.get(raw) ?? map.get(raw.toUpperCase()) ?? raw
  }
}

/**
 * Every code in ONE item's chain, resolved from both sources and unioned:
 * FINAPI's per-item history (authoritative, cheap, one call) and the merged
 * catalogue (carries aliases the per-item history sometimes doesn't).
 *
 * For per-item drill-downs — documents, fitment, anything keyed by raw code.
 * Always returns at least the requested code, so a FINAPI hiccup degrades to
 * today's single-code behaviour instead of an empty result.
 */
export async function itemChainCodes(code: string): Promise<string[]> {
  const requested = String(code ?? '').trim()
  const out = new Set<string>()
  if (requested) out.add(requested)

  const [history, chainMap] = await Promise.all([
    client.items.getHistory(requested).catch(() => null),
    getChainMap().catch(() => new Map<string, string>()),
  ])
  if (history?.canonical_code) out.add(history.canonical_code)
  for (const c of history?.item_id_history ?? []) if (c) out.add(String(c))

  const canonical = chainMap.get(requested) ?? chainMap.get(requested.toUpperCase()) ?? requested
  out.add(canonical)
  try {
    const item = (await getItems()).find((i) => i.code === canonical)
    if (item) for (const c of chainCodesOf(item)) out.add(c)
  } catch {
    // catalogue unavailable — the history codes above still stand
  }

  return [...out].map((c) => String(c).trim()).filter(Boolean)
}

export type ChainFoldSpec = {
  /** Field holding the raw ERP code; it is rewritten to the canonical code. */
  codeField: string
  /** Numeric fields to add up across the chain. */
  sum?: string[]
  /** Fields to keep the greatest value of (dates, "last seen"). */
  max?: string[]
  /** Fields to keep the longest value of (names — the fullest wins). */
  longest?: string[]
  /** Optional field to receive the folded-away sibling codes. */
  aliasField?: string
}

/**
 * Fold rows keyed by raw ERP code into one row per chain.
 *
 * IMPORTANT: fold BEFORE any LIMIT/slice/HAVING that ranks rows. Truncating
 * first can drop a chain member whose revenue belonged in the total, which is
 * how /top-items lost a chain that outranked everything left in its top 50.
 */
// The returned rows carry the input's fields plus `aliasField` when one is
// requested, which TypeScript cannot express as plain `R[]` — hence the index
// signature. R's own fields keep their exact types through the intersection;
// only a key that wasn't on R (i.e. aliasField) comes back as `unknown`.
export function foldByChain<R extends Record<string, unknown>>(
  rows: R[],
  canon: (code: string) => string,
  spec: ChainFoldSpec,
): (R & Record<string, unknown>)[] {
  const { codeField, sum = [], max = [], longest = [], aliasField } = spec
  const groups = new Map<string, R[]>()
  for (const r of rows) {
    const key = canon(String(r[codeField] ?? ''))
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }

  const out: (R & Record<string, unknown>)[] = []
  for (const [canonical, group] of groups) {
    // Base = the member already carrying the canonical code; failing that the
    // dominant row by the first summed field, so non-numeric fields we don't
    // explicitly merge come from the row that actually represents the part.
    const primary = sum[0]
    const base =
      group.find((r) => String(r[codeField] ?? '').trim() === canonical) ??
      (primary
        ? group.reduce((a, b) => ((Number(b[primary]) || 0) > (Number(a[primary]) || 0) ? b : a))
        : group[0])

    const merged: Record<string, unknown> = { ...base, [codeField]: canonical }
    for (const f of sum) merged[f] = 0
    for (const f of max) merged[f] = null
    for (const f of longest) merged[f] = ''

    for (const r of group) {
      for (const f of sum) merged[f] = (Number(merged[f]) || 0) + (Number(r[f]) || 0)
      for (const f of max) {
        const cand = r[f] as string | number | null | undefined
        const cur = merged[f] as string | number | null | undefined
        if (cand != null && (cur == null || cand > cur)) merged[f] = cand
      }
      for (const f of longest) {
        const cand = String(r[f] ?? '')
        if (cand.length > String(merged[f] ?? '').length) merged[f] = r[f]
      }
    }
    if (aliasField) {
      merged[aliasField] = group
        .map((r) => String(r[codeField] ?? '').trim())
        .filter((c) => c && c !== canonical)
    }
    out.push(merged as R & Record<string, unknown>)
  }
  return out
}

// ── Items with full enrichment ──

// In-flight deduplication: if getItems() is already running, reuse the same promise
let getItemsInflight: Promise<FinansitItem[]> | null = null

// In-memory cache fallback (for when Redis is unavailable)
// Set to null on startup to force fresh fetch after price-fix deployment
let inMemoryItemsCache: { data: FinansitItem[]; time: number } | null = null
const IN_MEMORY_FRESH_TTL = 30 * 60 * 1000  // 30 min
const IN_MEMORY_STALE_TTL = 6 * 60 * 60 * 1000  // 6 hours

// A healthy items snapshot has tens of thousands of rows; anything smaller is
// a degraded invoice-discovery fallback and must never masquerade as the catalog.
const HEALTHY_SNAPSHOT_FLOOR = 1000

export async function getItems(): Promise<FinansitItem[]> {
  const cacheKey = CACHE_VERSIONS.ITEMS_ENRICHED
  const staleCacheKey = `${CACHE_VERSIONS.ITEMS_ENRICHED}:stale`

  // Try in-memory fresh cache first (always populated, Redis may skip large payloads)
  if (inMemoryItemsCache && Date.now() - inMemoryItemsCache.time < IN_MEMORY_FRESH_TTL
      && inMemoryItemsCache.data.length >= HEALTHY_SNAPSHOT_FLOOR) {
    return inMemoryItemsCache.data
  }

  // Then try Redis (ignore degraded snapshots — see floor note above)
  const cached = await getCached<FinansitItem[]>(cacheKey)
  if (cached && cached.length >= HEALTHY_SNAPSHOT_FLOOR) return cached

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
  const t0 = Date.now()

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
  console.log(`[Analytics] getItems SDK calls took ${Date.now() - t0}ms (stock: ${stockItems?.length ?? 0}, catalog: ${catalogItems.length})`)

  // A healthy bulk stock feed has thousands of rows. FINAPI returns HTTP 200
  // with a tiny/empty list while its own stock cache is rebuilding — if we
  // build a snapshot from that, every analytics page shrinks to a handful of
  // items until the next refresh. Treat it as unavailable, kick a rebuild,
  // and serve the previous (stale) snapshot instead.
  const STOCK_FEED_FLOOR = 1000
  let effectiveStockItems = stockItems
  if (stockItems && stockItems.length > 0 && stockItems.length < STOCK_FEED_FLOOR) {
    console.warn(`[Analytics] stock feed returned only ${stockItems.length} rows — treating as unavailable, triggering stock rebuild`)
    refreshCache('stock').catch((err) => console.warn('[FINAPI] stock refresh failed:', err))
    effectiveStockItems = null
  }
  if (!effectiveStockItems || effectiveStockItems.length === 0) {
    const stalePrev = staleCacheKey ? await getCached<FinansitItem[]>(staleCacheKey) : null
    const candidate = (stalePrev && stalePrev.length >= STOCK_FEED_FLOOR) ? stalePrev
      : (inMemoryItemsCache && inMemoryItemsCache.data.length >= STOCK_FEED_FLOOR ? inMemoryItemsCache.data : null)
    if (candidate) {
      console.warn(`[Analytics] stock feed unavailable — serving previous snapshot (${candidate.length} items) while it rebuilds`)
      return candidate
    }
  }

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

    // Resolve names for items where item_name looks like a numeric code (barcode/alias).
    // These fall through the `stock.item_name || catalog?.name || code` chain to the raw
    // code when the bulk stock summary has no name AND the item is past fetchItems()'s
    // 10k-item catalog window. The authoritative name lives in the per-item endpoint
    // — the exact field the /items/[code] page renders — so we point-resolve it here
    // via resolveItemNames(), which reads it through POST /api/items/batch.
    // Blocking — must complete before buildChainMap so inMemoryItemsCache is always correct.
    // Cap bounds the worst-case COLD-START latency (this path only blocks when no cache
    // exists at all; the 6h refresh is stale-while-revalidate and never blocks a request).
    // 500 covers the forecast's max page size with headroom, and now costs ~5 FINAPI
    // calls instead of 500 — this used to be the app's single biggest call fan-out.
    const MAX_NAME_RESOLVE = 500
    const numericNameItems = items
      .filter(i => looksLikeCodeNotName(i.name, i.code))
      .slice(0, MAX_NAME_RESOLVE)
    if (numericNameItems.length > 0) {
      console.log(`[Analytics] Resolving ${numericNameItems.length} items with numeric/alias names via batch item endpoint`)
      const nameMap = await resolveItemNames(numericNameItems.map(i => i.code))
      let resolved = 0
      for (const item of numericNameItems) {
        const name = nameMap.get(item.code.toUpperCase())
        if (name) { item.name = name; resolved++ }
      }
      console.log(`[Analytics] Name resolution: ${resolved}/${numericNameItems.length} items got a real name`)
    }

    // Batch-fetch prices for items still at price=0 (catalog list doesn't include prices).
    //
    // `stock_qty > 0` used to gate this, which left every item with zero or
    // NEGATIVE stock showing price 0 even though the ERP has a real price
    // (e.g. 1683121580: stock -1, price 699.94). Those items still appear in
    // analytics — the stock-out forecast includes anything with stock or sales
    // this year — so match that population instead: any non-zero stock (over-
    // sold items included) or recent sales.
    const zeroPriceCodes = items
      .filter(i =>
        i.price === 0 &&
        ((i.stock_qty || 0) !== 0 || (i.sold_this_year || 0) > 0 || (i.sold_last_year || 0) > 0),
      )
      .map(i => i.code)
    if (zeroPriceCodes.length > 0) {
      try {
        // v5: the code set above widened, and the cached map is used wholesale —
        // a stale v4 entry would keep the newly-eligible items at 0.
        const priceCacheKey = 'items:prices:v5'
        let priceMap = await getCached<Record<string, number>>(priceCacheKey)
        if (!priceMap) {
          console.log(`[Analytics] Batch-fetching prices for ${zeroPriceCodes.length} items...`)
          priceMap = await fetchBatchPrices(zeroPriceCodes).catch(() => ({} as Record<string, number>))

          // Fall back to the latest dashboard.item_snapshots for any remaining
          // zero-price items. (Table is item_snapshots / column `price` — NOT the
          // old item_snapshot/retail_price, which silently errored and filled 0.)
          const stillMissing = zeroPriceCodes.filter(c => !priceMap![c.toUpperCase()])
          if (stillMissing.length > 0) {
            try {
              const BATCH = 500
              for (let i = 0; i < stillMissing.length; i += BATCH) {
                const batch = stillMissing.slice(i, i + BATCH)
                const pgResult = await readQueryAsync(
                  `SELECT item_code, price
                   FROM item_snapshots
                   WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM item_snapshots)
                     AND item_code IN (${batch.map(() => '?').join(',')}) AND price > 0`,
                  batch
                )
                for (const row of pgResult.rows) {
                  priceMap![row.item_code.toUpperCase()] = parseFloat(row.price)
                }
              }
            } catch (e) {
              console.warn('[Analytics] item_snapshots prices fallback failed:', e)
            }
          }

          // Only cache when the map is meaningfully populated. A near-empty map
          // (e.g. FINAPI was briefly busy/wedged) must NOT be frozen for 12h —
          // that's what made הון כלוא collapse to a fraction of the real value.
          const coverage = zeroPriceCodes.length ? Object.keys(priceMap).length / zeroPriceCodes.length : 1
          if (coverage >= 0.3) {
            await setCache(priceCacheKey, priceMap, 12 * 60 * 60) // 12h TTL
          } else {
            console.warn(`[Analytics] price coverage only ${(coverage * 100).toFixed(0)}% — NOT caching, will retry next request`)
          }
          console.log(`[Analytics] Got prices for ${Object.keys(priceMap).length}/${zeroPriceCodes.length} items`)
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

    const resolved = buildChainMap(items, await getChainLinks())
    cachedChainMap = resolved.codeToCanonical
    chainMapCacheTime = Date.now()
    console.log(`[Analytics] Chain resolution: ${items.length} → ${resolved.items.length} items`)
    // Only cache to Redis if payload is small enough for Upstash REST API
    // For large catalogs, in-memory cache is sufficient (single-container deployment)
    if (resolved.items.length <= 2000) {
      await setCache(cacheKey, resolved.items, CACHE_TTL.ITEMS)
      if (staleCacheKey) await setCache(staleCacheKey, resolved.items, STALE_TTL)
    }
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
    // Both formats in two bulk reads instead of one call per document.
    const detailsByFormat = await Promise.all([11, 31].map((fmt) =>
      fetchDocumentDetailsByNumber(fmt, allDocs.filter((d) => d.format === fmt).map((d) => d.doc_number)),
    ))
    {
      const details = detailsByFormat.flat()
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
  // One call per 100 codes instead of one per code — same payload per item.
  const enriched = await fetchItemsBatch([...activeItemCodes])
  for (const raw of enriched.values()) {
    const item = mapRawItem(raw)
    if (item) items.push(item)
  }
  console.log(`[Analytics] Enriched ${items.length} items with stock/sales data`)

  const resolved = buildChainMap(items, await getChainLinks())
  cachedChainMap = resolved.codeToCanonical
  chainMapCacheTime = Date.now()
  console.log(`[Analytics] Chain resolution: ${items.length} → ${resolved.items.length} items`)
  // Degraded discovery snapshot: cache briefly so we retry the real feed soon,
  // and never overwrite the stale key — it holds the last HEALTHY snapshot.
  await setCache(cacheKey, resolved.items, 10 * 60)
  inMemoryItemsCache = { data: resolved.items, time: Date.now() }
  return resolved.items
}

// ── Demand Analysis ──

export async function getDemandAnalysis(dateFrom?: string, dateTo?: string, forceRefresh = false): Promise<DemandItem[]> {
  const cacheKey = `analytics:demand:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = forceRefresh ? null : await getCached<DemandItem[]>(cacheKey)
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

    // Line items for the selected quotes — one feed call covering their number
    // range where possible, per-document reads for the rest. The quote SET is
    // unchanged: these are exactly the quotes the date filtering above picked.
    const recentQuotes = allQuotes.slice(0, 100)
    const allDetails = [await fetchDocumentDetailsByNumber(31, recentQuotes.map((q: any) => q.doc_number))]
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

  // Resolve names for demand items not found in itemMap (quote-only items with no stock)
  const unresolvedCodes = Array.from(demandMap.keys()).filter(code => code.length > 1 && !itemMap.has(code))
  const resolvedNameMap = new Map<string, string>()
  if (unresolvedCodes.length > 0) {
    // Same resolution strategy as the enriched-items backfill above, through the
    // same shared helper: batch item endpoint first, chain siblings second.
    // (It also applies looksLikeCodeNotName instead of the old /^\d+$/ test, which
    // let names like "0829193289    #####" through as if they were real.)
    // Cap raised from 50 so demand/gap rows for quote-only items stop rendering
    // their raw code — at 300 codes that is ~3 FINAPI calls, not 300.
    const MAX_NAME_RESOLVE = 300
    const codesToResolve = unresolvedCodes.slice(0, MAX_NAME_RESOLVE)
    console.log(`[Analytics] Resolving ${codesToResolve.length} demand item names via batch item endpoint`)
    for (const [code, name] of await resolveItemNames(codesToResolve)) {
      resolvedNameMap.set(code, name)
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
        name: item?.name || resolvedNameMap.get(code) || code,
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

// The daily_sales table is populated by a sync/cron that can lag (it was stuck at
// mid-month in prod). For recent days, aggregate live invoice headers from the SDK so
// the chart runs through today. Basis matches daily_sales (SUM of grand_total per day).
async function getLiveDailySales(from: string, to: string): Promise<SalesDataPoint[]> {
  const cacheKey = `analytics:daily-live:${from}:${to}`
  const cached = await getCached<SalesDataPoint[]>(cacheKey)
  if (cached) return cached
  try {
    const invoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 2000)
    const byDay = new Map<string, { revenue: number; count: number }>()
    for (const inv of invoices as any[]) {
      const d = (inv.doc_date || '').slice(0, 10)
      if (!d || d < from || d > to) continue
      const e = byDay.get(d) || { revenue: 0, count: 0 }
      e.revenue += Number(inv.grand_total ?? inv.total) || 0
      e.count += 1
      byDay.set(d, e)
    }
    const rows = [...byDay.entries()]
      .map(([date, v]) => ({ date, revenue: Math.round(v.revenue), count: v.count }))
      .sort((a, b) => a.date.localeCompare(b.date))
    await setCache(cacheKey, rows, 3600) // 1h — recent days settle quickly
    return rows
  } catch (e: any) {
    console.warn('[Analytics] getLiveDailySales failed:', e?.message)
    return []
  }
}

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

  const today = now.toISOString().split('T')[0]
  const dateTo = overrideDateTo || today

  let rows: SalesDataPoint[] = []

  // Try SQLite first (fast, local)
  try {
    const dbResult = await readQueryAsync(
      `SELECT date, revenue, invoice_count
       FROM daily_sales
       WHERE date >= ? AND date <= ?
       ORDER BY date`,
      [dateFrom, dateTo]
    )
    rows = dbResult.rows.map((r: any) => ({
      date: r.date,
      revenue: parseFloat(r.revenue) || 0,
      count: r.invoice_count || 0,
    }))
  } catch (e: any) {
    console.warn('[Analytics] getSalesData SQLite query failed:', e?.message)
  }

  // Fallback: Neon PostgreSQL
  if (rows.length === 0) {
    try {
      const pgResult = await dbQuery(
        `SELECT date::text as date, revenue, invoice_count
         FROM dashboard.daily_sales
         WHERE date >= $1 AND date <= $2
         ORDER BY date`,
        [dateFrom, dateTo]
      )
      rows = pgResult.rows.map((r: any) => ({
        date: r.date,
        revenue: parseFloat(r.revenue) || 0,
        count: r.invoice_count || 0,
      }))
    } catch (e: any) {
      console.warn('[Analytics] getSalesData Neon fallback failed:', e?.message)
    }
  }

  // Live-fill the recent gap: if the synced table lags behind the requested window
  // and that window reaches near today, aggregate the missing days live from the SDK.
  const recentCutoff = new Date(now.getTime() - 35 * 86400000).toISOString().split('T')[0]
  if (dateTo >= recentCutoff) {
    const lastDbDate = rows.length ? rows[rows.length - 1].date : null
    const gapFrom = lastDbDate
      ? new Date(new Date(lastDbDate).getTime() + 86400000).toISOString().split('T')[0]
      : (dateFrom > recentCutoff ? dateFrom : recentCutoff)
    if (gapFrom <= dateTo) {
      const live = await getLiveDailySales(gapFrom, dateTo)
      if (live.length > 0) {
        const byDate = new Map(rows.map((r) => [r.date, r]))
        for (const lr of live) byDate.set(lr.date, lr) // live wins for overlapping days
        rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
      }
    }
  }

  return rows
}

// ── Seasonal Correlation ──

export async function getSeasonalData(dateFrom?: string, dateTo?: string, forceRefresh = false): Promise<SeasonalDataPoint[]> {
  const cacheKey = `analytics:seasonal:v11:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = forceRefresh ? null : await getCached<SeasonalDataPoint[]>(cacheKey)
  if (cached) return cached

  // Strategy 1: PostgreSQL monthly_sales — fast, uses year/month columns directly
  try {
    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (dateFrom) {
      const fromYear = parseInt(dateFrom.substring(0, 4), 10)
      const fromMonth = parseInt(dateFrom.substring(5, 7), 10)
      conditions.push(`(year > $${paramIdx} OR (year = $${paramIdx + 1} AND month >= $${paramIdx + 2}))`)
      params.push(fromYear, fromYear, fromMonth)
      paramIdx += 3
    }
    if (dateTo) {
      const toYear = parseInt(dateTo.substring(0, 4), 10)
      const toMonth = parseInt(dateTo.substring(5, 7), 10)
      conditions.push(`(year < $${paramIdx} OR (year = $${paramIdx + 1} AND month <= $${paramIdx + 2}))`)
      params.push(toYear, toYear, toMonth)
      paramIdx += 3
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Aggregate by month only — avoids bogus category from SPLIT_PART(item_name,' ',1)
    // Divide total by distinct year count so the value represents a typical month, not a sum over years
    const sqliteWhere = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ').replace(/\$\d+/g, '?')}`
      : ''
    const dbResult = await readQueryAsync(
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
          const dailyResult = await readQueryAsync(`
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
          const dailySupp = await readQueryAsync(`
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
        // Number(), not the raw value: months backfilled from daily_sales above
        // are pushed as strings, and /seasonal matches with `d.month === i + 1`.
        // A string never equals a number there, so those months plotted as 0 —
        // while the month NAME still looked right, because `"3" - 1` coerces.
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

export async function getDeadStock(yearsThreshold: number = 1, forceRefresh = false): Promise<DeadStockItem[]> {
  const cacheKey = `analytics:dead-stock:v2:${yearsThreshold}`
  const cached = forceRefresh ? null : await getCached<DeadStockItem[]>(cacheKey)
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

/**
 * Reorder recommendations — thin wrapper over FINAPI's recommendation report.
 *
 * The recommended qty is NOT computed here. FINAPI owns it (method=coverage,
 * 3 months, rate measured over 90 days), because it reads real document lines;
 * this dashboard only ever saw pre-aggregated annual item-master totals. Before
 * this change the two engines disagreed on 78 of 150 active items (374 units vs
 * 210 over the same 90-day slice) — that gap was the whole reason to unify.
 *
 * The urgency score keeps its original multiplicative shape but runs on signals
 * that actually exist. The old score multiplied inquiry_count by 3, its heaviest
 * term — and inquiry_count is ERP field ItmMaxQty, which the paged /api/items
 * endpoint returns as 0 for every item. So the live formula had silently
 * degraded to (sold_this_year * 2 / pipeline) * recencyBoost, and
 * customer_breadth was pinned at 0. asked_qty (real format-31 quote lines in the
 * window) replaces it.
 *
 * Cost: the report is a 60-120s scan, so this must stay on a cached/cron path.
 */
export async function getReorderRecommendations(dateFrom?: string, dateTo?: string, forceRefresh = false): Promise<ReorderItem[]> {
  const cacheKey = `analytics:reorder:v3:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = forceRefresh ? null : await getCached<ReorderItem[]>(cacheKey)
  if (cached) return cached

  const [items, report] = await Promise.all([
    getItems(),
    fetchRecommendationReport().catch((e) => {
      console.warn('[Analytics] recommendation report failed:', e)
      return { rows: [], meta: {} }
    }),
  ])
  const now = new Date()
  const byCode = new Map(items.map(i => [i.code, i]))

  // dateFrom/dateTo are accepted for API compatibility but the demand window is
  // owned by the report (trailing 90 days); narrowing here would desync the
  // recommended_qty from the demand it was computed over.
  const currentMonth = now.getMonth() + 1
  const summerMonths = [5, 6, 7, 8, 9, 10]

  const reorderItems: ReorderItem[] = report.rows
    .map(row => {
      const item = byCode.get(row.code)
      const incomingQty = row.incoming ?? 0
      const orderedQty = row.on_order ?? 0
      // effectiveQty = on-hand + arriving + on-order (all supply pipeline)
      const effectiveQty = row.pipeline ?? (row.stock + incomingQty + orderedQty)

      // Recency from the report's own last_sold, falling back to last_quoted —
      // an item only ever quoted still carries live demand.
      const lastActivity = row.last_sold || row.last_quoted || item?.sale_date
      const daysSinceSale = lastActivity
        ? Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 86400000)
        : 365
      const recencyBoost = daysSinceSale < 30 ? 1.5 : daysSinceSale < 90 ? 1.2 : 1.0

      // FINAPI's flags are earned from document evidence — trust them over
      // anything re-derived here.
      const flags = row.flags ?? []
      const flagBoost =
        (flags.includes('lost_sales') ? 1.5 : 1) *      // quoted with zero stock — provably lost
        (flags.includes('stockout') ? 1.3 : 1) *        // runs out inside lead time
        (flags.includes('unreplenished') ? 1.2 : 1) *   // selling, nothing on order
        (flags.includes('dead_stock') ? 0.3 : 1)        // damp, don't hide

      const urgencyScore = ((row.asked_qty * 3 + row.sold_qty * 2) /
        Math.max(effectiveQty, 1)) * recencyBoost * flagBoost

      const soldThisYear = row.sold_this_year ?? item?.sold_this_year ?? 0
      const soldLastYear = row.sold_last_year ?? item?.sold_last_year ?? 0
      const demandVelocity = Math.min(soldThisYear / Math.max(soldLastYear, 1), 2)
      const stockCoverage = effectiveQty / Math.max(soldThisYear / 12, 1)
      // Breadth of demand: how much was asked for relative to a "broad" 10 units.
      // Was min(inquiry_count/10, 1), which was always 0.
      const customerBreadth = Math.min(row.asked_qty / 10, 1)

      // Dynamic seasonal relevance from last-sale month vs current season
      let seasonalRelevance = 0.5
      const seasonSource = row.last_sold || item?.sale_date
      if (seasonSource) {
        const saleMonth = parseInt(seasonSource.substring(5, 7), 10)
        const itemIsSummer = summerMonths.includes(saleMonth)
        const nowIsSummer = summerMonths.includes(currentMonth)
        // Higher relevance if item's season matches current season
        seasonalRelevance = itemIsSummer === nowIsSummer ? 0.9 : 0.2
        // Extra boost if we're approaching the item's peak season (within 2 months)
        const monthDiff = Math.abs(saleMonth - currentMonth)
        if (monthDiff <= 2 || monthDiff >= 10) seasonalRelevance = Math.min(seasonalRelevance + 0.2, 1.0)
      }

      // Supplier freshness from update_date
      const daysSinceUpdate = item?.update_date
        ? Math.floor((now.getTime() - new Date(item.update_date).getTime()) / 86400000)
        : undefined
      const supplierFreshness = daysSinceUpdate !== undefined
        ? Math.max(0, Math.min(1, 1 - daysSinceUpdate / 365))
        : 0.5

      return {
        code: row.code,
        name: item?.name || row.name,
        stock_qty: row.stock,
        incoming_qty: incomingQty,
        ordered_qty: orderedQty,
        inquiry_count: 0,   // deprecated — see the type; asked_qty replaces it
        sold_this_year: Math.round(soldThisYear),
        sold_last_year: Math.round(soldLastYear),
        price: row.retail_price ?? item?.price ?? 0,
        urgency_score: Math.round(urgencyScore * 100) / 100,
        demand_velocity: Math.round(demandVelocity * 100) / 100,
        stock_coverage: Math.round(stockCoverage * 10) / 10,
        seasonal_relevance: Math.round(seasonalRelevance * 100) / 100,
        customer_breadth: Math.round(customerBreadth * 100) / 100,
        sale_date: row.last_sold ?? item?.sale_date,
        purchase_date: item?.purchase_date,
        days_since_sale: daysSinceSale,
        supplier_freshness: Math.round(supplierFreshness * 100) / 100,
        alias_codes: item?.alias_codes,
        // FINAPI's number, not ours — one recommendation across page, board and MCP.
        recommended_qty: row.recommended_qty,

        // Report provenance, so the UI can explain WHY an item is here.
        asked_qty: row.asked_qty,
        sold_qty: row.sold_qty,
        gap: row.gap,
        pipeline: effectiveQty,
        monthly_sold: row.monthly_sold,
        monthly_asked: row.monthly_asked,
        days_of_stock_left: row.days_of_stock_left,
        stockout_date: row.stockout_date,
        flags,
        last_sold: row.last_sold,
        last_quoted: row.last_quoted,
        order_age_days: row.order_age_days,
        replaced_by: row.replaced_by,
      }
    })
    .sort((a, b) => b.urgency_score - a.urgency_score)
    .slice(0, 500)

  await setCache(cacheKey, reorderItems, CACHE_TTL.ANALYTICS)
  return reorderItems
}

// ── Top Selling Items ──

/**
 * The per-warehouse stock feed (fetchAllStockItems / client.stock.*) is out of sync
 * with item-level stock for some items: a real in-stock item can show 0 or be missing
 * from the bulk feed entirely (e.g. 9850364680 — 36 in stock, absent from /all). The
 * item endpoint (client.items.get) returns the authoritative qty — the same value the
 * ItemHoverCard shows. Reconcile a top-items result against it so the table's stock
 * column matches the hover. Bounded to the ≤20 displayed rows, run in parallel; a
 * failed lookup keeps the existing value.
 */
async function reconcileStockFromItemApi(rows: TopSellingItem[]): Promise<void> {
  if (!rows.length) return
  // Runs on EVERY request, cache hit included, so it is worth the single call:
  // ≤20 rows = 1 batch call rather than 20 lookups queued behind a 4-seat transport.
  const live = await fetchItemsBatch(rows.map(r => r.code))
  for (const r of rows) {
    const qty = Number(live.get(r.code.toUpperCase())?.stock_qty)
    if (Number.isFinite(qty)) r.stock_qty = qty // a missing item keeps the existing value
  }
}

export async function getTopSellingItems(period: string = '30d', forceRefresh = false): Promise<TopSellingItem[]> {
  const cacheKey = `analytics:top-items:v2:${period}`
  const cached = forceRefresh ? null : await getCached<TopSellingItem[]>(cacheKey)
  if (cached) {
    // Only sales aggregates are cached; stock can be stale/wrong (bulk feed quirk),
    // so always reconcile the ≤20 displayed rows against the authoritative item API
    // so the table's מלאי matches the hover card.
    await reconcileStockFromItemApi(cached)
    return cached
  }

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

    // GROUP BY item_code ONLY. Grouping by item_name as well split a single
    // code across its name spellings in monthly_sales — 17 of the top 20 were
    // affected, and pseudo-item `000` reported ₪22,302 of a real ₪91,004 across
    // 7 variants. MAX() picks one name; the chain fold below prefers the fullest.
    //
    // And take 500 rows, not 50: the chain fold must happen BEFORE the cut, or a
    // sibling ranked 200th never gets added to the canonical row that displays.
    const dbResult = await readQueryAsync(
      `SELECT item_code,
              MAX(item_name) AS item_name,
              SUM(quantity) AS total_qty,
              SUM(revenue) AS total_revenue,
              SUM(invoice_count) AS total_count
       FROM monthly_sales
       WHERE (year > ? OR (year = ? AND month >= ?))
         AND (year < ? OR (year = ? AND month <= ?))
       GROUP BY item_code
       HAVING SUM(revenue) > 0
       ORDER BY total_revenue DESC
       LIMIT 500`,
      [fromYear, fromYear, fromMonth, toYear, toYear, toMonth]
    )

    if (dbResult.rows.length > 0) {
      const items = await getItems()
      const itemMap = new Map(items.map(i => [i.code, i]))
      const canon = await getCanonicalizer()

      // Fold the supersession chains, THEN rank. 9863013680 showed ₪66,612 while
      // its alias 9833964280 held another ₪25,648 of the same part's sales.
      const folded = foldByChain(dbResult.rows as any[], canon, {
        codeField: 'item_code',
        sum: ['total_revenue', 'total_qty', 'total_count'],
        longest: ['item_name'],
      }).sort((a: any, b: any) => (Number(b.total_revenue) || 0) - (Number(a.total_revenue) || 0))

      const result: TopSellingItem[] = folded.map((r: any) => {
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
          // SUM() over a bigint comes back as a string; the field is typed number.
          invoice_count: Number(r.total_count) || 0,
          avg_price: parseFloat(r.total_qty) > 0 ? Math.round(parseFloat(r.total_revenue) / parseFloat(r.total_qty)) : 0,
          stock_qty: item?.stock_qty || 0,
          sale_date: item?.sale_date,
          trend,
          alias_codes: item?.alias_codes,
        }
      }).slice(0, 20)

      await reconcileStockFromItemApi(result)
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
    // One feed call for the whole window when the box supports it (falls back to
    // per-document reads otherwise). Date filtering moves AFTER the fetch: it used
    // to run first purely to cut the number of round trips, which is no longer the cost.
    const allInvoices = await fetchRecentDocumentDetails(DOC_FORMATS.TAX_INVOICE, 200)
    const today = now.toISOString().split('T')[0]
    const invoices = allInvoices.filter((inv: any) => {
      const d = inv.doc_date
      return d && d >= dateFrom && d <= today
    })

    const itemSales = new Map<string, { name: string; qty: number; revenue: number; count: number }>()
    {
      for (const detail of invoices) {
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

    await reconcileStockFromItemApi(result)
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

export async function getConversionAnalysis(dateFrom?: string, dateTo?: string, forceRefresh = false) {
  const cacheKey = `analytics:conversion:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = forceRefresh ? null : await getCached<any>(cacheKey)
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

    // Quotes: line details for up to 30 docs — one bulk read over their number
    // range, per-document reads for anything it misses. Same 30 documents.
    const toFetch = docs.slice(0, 30)
    const allDetails = await fetchDocumentDetailsByNumber(format, toFetch.map((d: any) => d.doc_number))
    for (const detail of allDetails) {
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
        itemStats.set(line.item_code, { code: line.item_code, name: line.item_name || line.item_code, timesQuoted: 0, timesSold: 0, lostValue: 0, lastQuoted: '' } as any)
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

export async function getABCClassification(dateFrom?: string, dateTo?: string, forceRefresh = false) {
  const cacheKey = `analytics:abc:v4:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = forceRefresh ? null : await getCached<any>(cacheKey)
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
    const salesResult = await readQueryAsync(
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

export async function getCustomerAnalytics(dateFrom?: string, dateTo?: string, forceRefresh = false) {
  const cacheKey = `analytics:customers:v7:${dateFrom || 'all'}:${dateTo || 'all'}`
  const cached = forceRefresh ? null : await getCached<any>(cacheKey)
  if (cached) return cached

  const now = new Date()
  const activeYear = now.getFullYear()
  const effDateFrom = dateFrom || `${activeYear}-01-01`
  const effDateTo = dateTo || now.toISOString().split('T')[0]
  const fromYear = parseInt(effDateFrom.substring(0, 4), 10)
  const toYear = parseInt(effDateTo.substring(0, 4), 10)

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
      const pgResult = await readQueryAsync(
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
        } catch (e) {
          console.error(`[Analytics] Customer history year ${y} fetch failed:`, e)
        }
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
    } catch (e) {
      console.error(`[Analytics] Customer partial year ${y} fetch failed:`, e)
    }
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
    } catch (e) {
      console.error('[Analytics] Customer active year FINAPI fetch failed:', e)
    }

    // If FINAPI returned nothing for the active year, fall back to PostgreSQL
    const activeYearInvoiceCount = allInvoices.filter(inv => !inv.is_credit && inv.doc_date >= (fromYear === activeYear ? effDateFrom : `${activeYear}-01-01`)).length
    if (activeYearInvoiceCount === 0) {
      const yFrom = fromYear === activeYear ? effDateFrom : `${activeYear}-01-01`
      const yTo = effDateTo
      try {
        const docsResult = await readQueryAsync(
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

  console.log(`[Analytics] Customers: total allInvoices=${allInvoices.length} for range ${effDateFrom}–${effDateTo} (years ${fromYear}–${toYear}, activeYear=${activeYear})`)

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

  // Churn needs previous-year revenue, but the default (this-year) range never loads
  // last year — so seed it from Postgres customer_stats. This both fixes the trend of
  // existing customers and surfaces customers who bought last year but nothing this
  // year (true churn). Skip if the selected range already covers last year.
  const lyStart = `${activeYear - 1}-01-01`
  const lyEnd = `${activeYear - 1}-12-31`
  const lastYearAlreadyLoaded = allInvoices.some(inv => inv.doc_date >= lyStart && inv.doc_date <= lyEnd)
  if (!lastYearAlreadyLoaded) {
    try {
      const ly = await dbQuery(
        `SELECT customer_code, MAX(customer_name) AS customer_name,
                SUM(total_revenue::numeric) AS rev
         FROM dashboard.customer_stats
         WHERE year = $1
         GROUP BY customer_code`,
        [activeYear - 1]
      )
      const byCode = new Map(customers.map(c => [c.code, c]))
      for (const row of ly.rows as any[]) {
        const rev = Math.round(Number(row.rev) || 0)
        if (rev <= 0 || !row.customer_code) continue
        const existing = byCode.get(row.customer_code)
        if (existing) {
          existing.last_year_revenue = rev
          const ratio = existing.this_year_revenue / rev
          existing.trend = ratio > 1.2 ? 'up' : ratio < 0.8 ? 'down' : 'stable'
        } else {
          const c = {
            code: row.customer_code,
            name: customerNames.get(row.customer_code) || row.customer_name || row.customer_code,
            gross_invoices: 0, total_credits: 0, total_revenue: 0, invoice_count: 0,
            avg_order_value: 0, first_purchase: lyEnd, last_purchase: lyEnd,
            this_year_revenue: 0, last_year_revenue: rev, unique_items: 0,
            trend: 'down' as const,
          }
          customers.push(c)
          byCode.set(row.customer_code, c)
        }
      }
      console.log(`[Analytics] Customers: seeded last-year (${activeYear - 1}) revenue from customer_stats (${ly.rows.length} rows)`)
    } catch (e: any) {
      console.warn('[Analytics] Customers last-year seed failed:', e?.message)
    }
  }

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
