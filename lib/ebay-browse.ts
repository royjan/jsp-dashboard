/**
 * eBay Browse API client — live "new" asking prices for a part across
 * marketplaces, converted to ₪, for the /ebay-reco price comparison.
 *
 * Credentials come from Secrets Manager (`config`): EBAY_APP_ID_PROD /
 * EBAY_CERT_ID_PROD (production keyset). The app OAuth token (client-credentials)
 * and the FX table are cached in Redis so we don't re-auth / re-fetch per call.
 *
 * Matching is deliberately conservative — eBay keyword search on a part number
 * returns a lot of noise, so we keep only condition=NEW, fixed-price listings
 * whose *title actually contains the MPN*, then take the median. `matchCount`
 * is surfaced so low-confidence comparables (1–2 hits) are visible, not trusted
 * blindly. Some OEM numbers simply aren't on eBay → no comparable (null).
 */
import { getSecret } from './aws-secrets'
import { getCached, setCache } from './redis-client'

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'

// Auto-parts-relevant Browse marketplaces + their currencies.
export const EBAY_MARKETS: Array<{ id: string; currency: string; flag: string }> = [
  { id: 'EBAY_GB', currency: 'GBP', flag: '🇬🇧' },
  { id: 'EBAY_US', currency: 'USD', flag: '🇺🇸' },
  { id: 'EBAY_DE', currency: 'EUR', flag: '🇩🇪' },
  { id: 'EBAY_FR', currency: 'EUR', flag: '🇫🇷' },
  { id: 'EBAY_IT', currency: 'EUR', flag: '🇮🇹' },
  { id: 'EBAY_ES', currency: 'EUR', flag: '🇪🇸' },
  { id: 'EBAY_IE', currency: 'EUR', flag: '🇮🇪' },
  { id: 'EBAY_NL', currency: 'EUR', flag: '🇳🇱' },
  { id: 'EBAY_AU', currency: 'AUD', flag: '🇦🇺' },
  { id: 'EBAY_CA', currency: 'CAD', flag: '🇨🇦' },
]
const CURRENCIES = [...new Set(EBAY_MARKETS.map(m => m.currency))]
const MARKET_FLAG = new Map(EBAY_MARKETS.map(m => [m.id, m.flag]))
/** Flag emoji for a marketplace id (e.g. EBAY_DE → 🇩🇪); '' if unknown. */
export const marketFlag = (id: string | null | undefined): string => (id ? MARKET_FLAG.get(id) || '' : '')

export type MarketComparable = {
  market: string; currency: string
  medianLocal: number; medianIls: number; matchCount: number
  oem: boolean          // true = the median is built from genuine/OEM listings
  url: string | null    // link to the representative listing (nearest the median)
  title: string | null
}
export type EbayComparable = {
  bestMarket: string | null; medianIls: number | null; medianLocal: number | null
  currency: string | null; matchCount: number; oem: boolean
  bestUrl: string | null; bestTitle: string | null
  markets: MarketComparable[]
}

const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
// Genuine/OEM signal in a listing title. Jan Parts sells OEM, so comparing
// against aftermarket is apples-to-oranges — we prefer these when present.
const OEM_RE = /\b(genuine|original|o\.?e\.?m|o\.?e\b|oes|echt|origineel|origine|originale?|d'origine)\b/i
function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ── App OAuth token (client-credentials), cached in Redis 2h ──
const TOKEN_KEY = 'ebay:browse:token'
let memToken: { token: string; exp: number } | null = null

export async function getEbayToken(): Promise<string> {
  if (memToken && Date.now() < memToken.exp) return memToken.token
  const cached = await getCached<string>(TOKEN_KEY)
  if (cached) { memToken = { token: cached, exp: Date.now() + 60 * 60_000 }; return cached }

  const appId = getSecret('EBAY_APP_ID_PROD')
  const certId = getSecret('EBAY_CERT_ID_PROD')
  if (!appId || !certId) throw new Error('eBay credentials missing (EBAY_APP_ID_PROD / EBAY_CERT_ID_PROD)')
  const basic = Buffer.from(`${appId}:${certId}`).toString('base64')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`eBay token failed: ${JSON.stringify(data).slice(0, 200)}`)
  // eBay app tokens live ~2h; cache a little under that.
  const ttl = Math.max(300, (Number(data.expires_in) || 7200) - 300)
  await setCache(TOKEN_KEY, data.access_token, ttl)
  memToken = { token: data.access_token, exp: Date.now() + ttl * 1000 }
  return data.access_token
}

// ── FX → ILS (ECB via frankfurter, free/no-key), cached in Redis 24h ──
const FX_KEY = 'ebay:fx:ils'

export async function getFxToIls(): Promise<Record<string, number>> {
  const cached = await getCached<Record<string, number>>(FX_KEY)
  if (cached) return cached
  const res = await fetch(`https://api.frankfurter.app/latest?from=ILS&to=${CURRENCIES.join(',')}`)
  const data = await res.json()
  const ilsTo = data.rates || {} // ILS → X ; invert for X → ILS
  const out: Record<string, number> = {}
  for (const c of CURRENCIES) if (ilsTo[c]) out[c] = 1 / ilsTo[c]
  if (Object.keys(out).length) await setCache(FX_KEY, out, 24 * 3600)
  return out
}

type Listing = { price: number; url: string | null; title: string; oem: boolean }
type MarketData = { medianLocal: number | null; matchCount: number; oem: boolean; url: string | null; title: string | null }

// ── One marketplace: median "new" asking price for an MPN, in local currency ──
// Prefers genuine/OEM listings when any exist (fairer vs our OEM stock), and
// returns a representative listing (nearest the median) with its eBay link.
async function marketData(token: string, mpn: string, market: string): Promise<MarketData> {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(mpn)}&filter=conditions:{NEW},buyingOptions:{FIXED_PRICE}&limit=50`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': market },
  })
  if (!res.ok) return { medianLocal: null, matchCount: 0, oem: false, url: null, title: null }
  const data = await res.json()
  const n = norm(mpn)
  // Keep only listings whose title actually contains the MPN — kills keyword noise.
  const matched: Listing[] = (data.itemSummaries || [])
    .filter((i: any) => i.price && norm(i.title).includes(n))
    .map((i: any) => ({ price: Number(i.price.value), url: i.itemWebUrl || null, title: i.title || '', oem: OEM_RE.test(i.title || '') }))
    .filter((l: Listing) => l.price > 0)
  if (!matched.length) return { medianLocal: null, matchCount: 0, oem: false, url: null, title: null }

  // Prefer OEM/original listings when we have some; otherwise fall back to all NEW.
  const oemHits = matched.filter(l => l.oem)
  const useOem = oemHits.length > 0
  const set = useOem ? oemHits : matched
  const med = median(set.map(l => l.price))!
  // Representative "best match" = the listing closest to the median price.
  const rep = set.reduce((a, b) => (Math.abs(b.price - med) < Math.abs(a.price - med) ? b : a))
  return { medianLocal: med, matchCount: set.length, oem: useOem, url: rep.url, title: rep.title }
}

/** Best (highest-median) "new/OEM" eBay comparable for an MPN across all markets. */
export async function fetchEbayComparable(mpn: string): Promise<EbayComparable> {
  const [token, fx] = await Promise.all([getEbayToken(), getFxToIls()])
  // Markets in parallel — one part hits ~10 marketplaces; sequential would blow
  // the cron's time budget on large batches.
  const markets = (await Promise.all(EBAY_MARKETS.map(async m => {
    const d = await marketData(token, mpn, m.id)
    if (d.medianLocal == null || !fx[m.currency]) return null
    return {
      market: m.id, currency: m.currency, medianLocal: d.medianLocal,
      medianIls: Math.round(d.medianLocal * fx[m.currency]), matchCount: d.matchCount,
      oem: d.oem, url: d.url, title: d.title,
    } as MarketComparable
  }))).filter((x): x is MarketComparable => x !== null)
  if (!markets.length) return { bestMarket: null, medianIls: null, medianLocal: null, currency: null, matchCount: 0, oem: false, bestUrl: null, bestTitle: null, markets: [] }
  // Prefer markets with an OEM-based median; among those (or all, if none), take
  // the highest median — the best place to sell — as the headline comparable.
  const oemMarkets = markets.filter(m => m.oem)
  const pool = oemMarkets.length ? oemMarkets : markets
  const best = pool.reduce((a, b) => (b.medianIls > a.medianIls ? b : a))
  return {
    bestMarket: best.market, medianIls: best.medianIls, medianLocal: best.medianLocal,
    currency: best.currency, matchCount: best.matchCount, oem: best.oem,
    bestUrl: best.url, bestTitle: best.title, markets,
  }
}
