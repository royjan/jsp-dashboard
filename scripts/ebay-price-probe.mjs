// Throwaway validator: our dead-stock price vs live eBay asking prices across
// marketplaces. Proves the Browse-API + MPN-match + median + FX→ILS pipeline on
// real parts before we productionize it. Reads eBay creds from Secrets Manager
// `config` (eu-central-1). Run: node scripts/ebay-price-probe.mjs
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const MARKETS = [
  ['EBAY_GB', 'GBP', '🇬🇧'], ['EBAY_US', 'USD', '🇺🇸'], ['EBAY_DE', 'EUR', '🇩🇪'],
  ['EBAY_FR', 'EUR', '🇫🇷'], ['EBAY_IT', 'EUR', '🇮🇹'], ['EBAY_ES', 'EUR', '🇪🇸'],
]

// (code, our ₪ price, label) — pulled from the live /ebay-reco table.
const PARTS = [
  ['1675686880', 37177, "גיר אוטו ג'מפי"],
  ['1684870280', 21087, 'מחמם מים למנוע'],
  ['1984C2', 1657, "אינג'קטור 206"],
  ['JUKE4', 6401, 'סט שיפור ניסאן'],
  ['9835855380', 15966, 'טורבו 8003'],
  ['1617410580', 13199, "מש ה\"כ ג'מפי"],
]

const norm = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function getCreds() {
  const c = new SecretsManagerClient({ region: 'eu-central-1' })
  const r = await c.send(new GetSecretValueCommand({ SecretId: 'config' }))
  const j = JSON.parse(r.SecretString)
  return { app: j.EBAY_APP_ID_PROD, cert: j.EBAY_CERT_ID_PROD }
}

async function getToken({ app, cert }) {
  const basic = Buffer.from(`${app}:${cert}`).toString('base64')
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })
  return (await r.json()).access_token
}

// EUR/GBP/USD → ILS via frankfurter (ECB, free, no key).
async function getFx() {
  const r = await fetch('https://api.frankfurter.app/latest?from=ILS&to=EUR,GBP,USD')
  const rates = (await r.json()).rates // ILS→X ; invert to X→ILS
  return { EUR: 1 / rates.EUR, GBP: 1 / rates.GBP, USD: 1 / rates.USD }
}

async function comparables(token, mpn, market) {
  // condition=NEW (exclude used / for-parts) + fixed-price (asking, not auction).
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(mpn)}` +
    `&filter=conditions:{NEW},buyingOptions:{FIXED_PRICE}&limit=50`
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': market },
  })
  const d = await r.json()
  const items = d.itemSummaries || []
  const n = norm(mpn)
  // Keep only listings whose title actually contains the MPN — kills keyword noise.
  const matched = items.filter((i) => norm(i.title).includes(n) && i.price)
  return { total: d.total || 0, matched: matched.length, prices: matched.map((i) => +i.price.value) }
}

const fmt = (n) => n == null ? '—' : '₪' + Math.round(n).toLocaleString('en-US')

const creds = await getCreds()
const token = await getToken(creds)
const fx = await getFx()
console.log('FX →₪:', Object.fromEntries(Object.entries(fx).map(([k, v]) => [k, v.toFixed(2)])), '\n')

for (const [code, ourIls, label] of PARTS) {
  console.log(`\n${code}  ${label}  — our price ${fmt(ourIls)}`)
  for (const [market, cur, flag] of MARKETS) {
    const { total, matched, prices } = await comparables(token, code, market)
    const medLocal = median(prices)
    const medIls = medLocal == null ? null : medLocal * fx[cur]
    const spread = medIls == null ? '' :
      `| eBay is ${medIls > ourIls ? '+' : ''}${Math.round((medIls / ourIls - 1) * 100)}% vs us`
    console.log(
      `  ${flag} ${market.padEnd(8)} matched ${String(matched).padStart(2)}/${String(total).padStart(3)} ` +
      `| median ${medLocal == null ? '—' : cur + ' ' + Math.round(medLocal)} → ${fmt(medIls)} ${spread}`,
    )
  }
}
