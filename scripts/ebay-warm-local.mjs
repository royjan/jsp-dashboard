// One-off / manual warmer for dashboard.ebay_price_compare, run from a machine
// that HAS the eBay creds (Secrets Manager) + Neon access — used because the
// Dokploy prod env doesn't carry the eBay keys yet, so the in-app cron can't run.
//
// Pulls candidate codes from prod /ebay-recommend (already sorted by match score,
// so the most important dead stock is priced first), computes the best "new"
// eBay comparable across marketplaces, and upserts to the prod table. Idempotent.
//
//   node scripts/ebay-warm-local.mjs [limit]     (default 60)
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import pg from 'pg'
import fs from 'node:fs'

const LIMIT = Number(process.argv[2]) || 60
const PROD = 'http://192.168.0.112:3002'

const MARKETS = [
  ['EBAY_GB', 'GBP'], ['EBAY_US', 'USD'], ['EBAY_DE', 'EUR'], ['EBAY_FR', 'EUR'],
  ['EBAY_IT', 'EUR'], ['EBAY_ES', 'EUR'], ['EBAY_IE', 'EUR'], ['EBAY_NL', 'EUR'],
  ['EBAY_AU', 'AUD'], ['EBAY_CA', 'CAD'],
]
const CURRENCIES = [...new Set(MARKETS.map(m => m[1]))]
const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

function dbUrl() {
  const env = fs.readFileSync('.env.local', 'utf8')
  return env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').replace(/^"|"$/g, '')
}
async function creds() {
  const c = new SecretsManagerClient({ region: 'eu-central-1' })
  const j = JSON.parse((await c.send(new GetSecretValueCommand({ SecretId: 'config' }))).SecretString)
  return { app: j.EBAY_APP_ID_PROD, cert: j.EBAY_CERT_ID_PROD }
}
async function token({ app, cert }) {
  const basic = Buffer.from(`${app}:${cert}`).toString('base64')
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })
  return (await r.json()).access_token
}
async function fx() {
  const r = await fetch(`https://api.frankfurter.app/latest?from=ILS&to=${CURRENCIES.join(',')}`)
  const rates = (await r.json()).rates
  return Object.fromEntries(CURRENCIES.map(c => [c, 1 / rates[c]]))
}
async function marketMedian(tok, mpn, market) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(mpn)}&filter=conditions:{NEW},buyingOptions:{FIXED_PRICE}&limit=50`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, 'X-EBAY-C-MARKETPLACE-ID': market } })
  if (!r.ok) return { medianLocal: null, matchCount: 0 }
  const d = await r.json(), n = norm(mpn)
  const prices = (d.itemSummaries || []).filter(i => i.price && norm(i.title).includes(n)).map(i => +i.price.value).filter(v => v > 0)
  return { medianLocal: median(prices), matchCount: prices.length }
}
async function comparable(tok, rates, mpn) {
  const per = (await Promise.all(MARKETS.map(async ([id, cur]) => {
    const { medianLocal, matchCount } = await marketMedian(tok, mpn, id)
    return medianLocal == null || !rates[cur] ? null
      : { market: id, currency: cur, medianLocal, medianIls: Math.round(medianLocal * rates[cur]), matchCount }
  }))).filter(Boolean)
  if (!per.length) return { bestMarket: null, medianIls: null, medianLocal: null, currency: null, matchCount: 0, markets: [] }
  const best = per.reduce((a, b) => (b.medianIls > a.medianIls ? b : a))
  return { bestMarket: best.market, medianIls: best.medianIls, medianLocal: best.medianLocal, currency: best.currency, matchCount: best.matchCount, markets: per }
}

const [{ app, cert }, rates, candResp] = await Promise.all([
  creds(), fx(), fetch(`${PROD}/api/analytics/ebay-recommend`).then(r => r.json()),
])
const tok = await token({ app, cert })
const codes = candResp.items.slice(0, LIMIT).map(i => i.code) // already sorted by match score desc
console.log(`FX→₪:`, Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, v.toFixed(2)])))
console.log(`warming ${codes.length} top-match parts…`)

const client = new pg.Client({ connectionString: dbUrl() })
await client.connect()
let done = 0, withCmp = 0
for (const code of codes) {
  const c = await comparable(tok, rates, code)
  await client.query(
    `INSERT INTO dashboard.ebay_price_compare (item_code,best_market,median_ils,median_local,currency,match_count,markets,checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (item_code) DO UPDATE SET best_market=$2,median_ils=$3,median_local=$4,currency=$5,match_count=$6,markets=$7,checked_at=now()`,
    [code, c.bestMarket, c.medianIls, c.medianLocal, c.currency, c.matchCount, JSON.stringify(c.markets)],
  )
  done++; if (c.bestMarket) withCmp++
  if (c.bestMarket) console.log(`  ${code.padEnd(12)} → ₪${c.medianIls} ${c.bestMarket} (${c.matchCount})`)
  else console.log(`  ${code.padEnd(12)} → no comparable`)
}
await client.end()
console.log(`\ndone: ${done} processed, ${withCmp} with an eBay comparable`)
