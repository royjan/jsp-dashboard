/**
 * Regression guard for the chain-fold helper that eight analytics routes now
 * depend on. No test runner in this repo — run it directly:
 *
 *   npx tsx scripts/check-chain-fold.ts
 *
 * The fixtures are REAL chains from erp.items (1920LL → 9819938480 →
 * 1675941280, and 9833964280 → 9863013680, the pair that made /top-items
 * understate its #1 item by ₪25,648).
 */
import { foldByChain, chainCodesOf, buildStockedVariantIndex } from '../lib/services/analytics-service'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (!cond) { failures++; console.log('FAIL', name, extra ?? '') } else console.log('ok  ', name)
}

// The real chain from the ERP: 1920LL -> 9819938480 -> 1675941280
const canonMap = new Map<string, string>([
  ['1920LL', '1675941280'], ['9819938480', '1675941280'], ['1675941280', '1675941280'],
  ['9833964280', '9863013680'], ['9863013680', '9863013680'],
])
const canon = (c: string) => canonMap.get(c) ?? c

const rows = [
  { item_code: '9833964280', item_name: 'פלג', revenue: 25648, qty: 3, last: '2025-03-01' },
  { item_code: '9863013680', item_name: 'פלג 1.2 טורבו ללא ראש', revenue: 66612, qty: 9, last: '2026-07-01' },
  { item_code: '1920LL', item_name: '0821495761', revenue: 100, qty: 1, last: '2024-01-01' },
  { item_code: '9819938480', item_name: '0821495761', revenue: 200, qty: 2, last: '2024-06-01' },
  { item_code: '1675941280', item_name: 'מש לחץ גבוהה', revenue: 5950, qty: 2, last: '2026-02-01' },
  { item_code: 'LONELY', item_name: 'x', revenue: 7, qty: 1, last: '2020-01-01' },
]

const out = foldByChain(rows, canon, {
  codeField: 'item_code', sum: ['revenue', 'qty'], max: ['last'], longest: ['item_name'], aliasField: 'aliases',
})
const by = new Map(out.map(r => [r.item_code as string, r]))

check('folds to one row per chain', out.length === 3, out.map(r => r.item_code))
check('sums revenue across chain', by.get('9863013680')!.revenue === 92260, by.get('9863013680')!.revenue)
check('sums the 3-member chain', by.get('1675941280')!.revenue === 6250, by.get('1675941280')!.revenue)
check('sums qty', by.get('1675941280')!.qty === 5, by.get('1675941280')!.qty)
check('keeps the newest date', by.get('1675941280')!.last === '2026-02-01', by.get('1675941280')!.last)
check('prefers the fullest name over a code-looking one',
  by.get('1675941280')!.item_name === 'מש לחץ גבוהה', by.get('1675941280')!.item_name)
check('records the folded-away codes',
  JSON.stringify((by.get('1675941280')!.aliases as string[]).sort()) === JSON.stringify(['1920LL', '9819938480']),
  by.get('1675941280')!.aliases)
check('a lone code survives untouched', by.get('LONELY')!.revenue === 7)
check('lone code gets an empty alias list', (by.get('LONELY')!.aliases as string[]).length === 0)
check('unknown codes map to themselves (degraded chain map is safe)',
  foldByChain([{ c: 'A', v: 1 }, { c: 'B', v: 2 }], (x) => x, { codeField: 'c', sum: ['v'] }).length === 2)

// ── the two orderings that keep going wrong ─────────────────────────────────────────
// A THRESHOLD BELONGS AFTER THE FOLD. /seasonal asked the SQL for `HAVING SUM(revenue) >
// 500` per raw code, so a chain that sold 300 under the old number and 300 under the new
// one was dropped before anything could add them up — the part is simply missing from the
// page, with nothing to say it was excluded. Measured 2026-08-22 on dashboard.monthly_sales:
// 5 chains invisible that way and 10 more counted short.
const splitLow = [
  { item_code: '1920LL', revenue: 300 },
  { item_code: '9819938480', revenue: 300 },
  { item_code: 'LONELY', revenue: 400 },
]
const foldedLow = foldByChain(splitLow, canon, { codeField: 'item_code', sum: ['revenue'] })
check('a floor applied AFTER the fold keeps a chain no single code passes',
  foldedLow.filter((r) => (r.revenue as number) > 500).map((r) => r.item_code).join() === '1675941280',
  foldedLow)
check('...and the same floor applied BEFORE the fold would have dropped it',
  splitLow.filter((r) => r.revenue > 500).length === 0)

// COUNTING PARTS MEANS COUNTING FOLDED ROWS. /report's "active items" KPI counted
// DISTINCT item_code straight out of monthly_sales: 4,300 codes for 4,252 real parts.
check('a chain counts once, not once per code',
  foldByChain(rows, canon, { codeField: 'item_code', sum: ['revenue'] }).length === 3, rows.length)

// chainCodesOf unions all four sources and de-duplicates
const codes = chainCodesOf({
  code: '1675941280', alias_codes: ['1920LL', '9819938480'],
  chain_history: ['1920LL', '9819938480', '1675941280'], item_id_history: ['1920LL'],
})
check('chainCodesOf de-duplicates across all sources', codes.length === 3, codes)
check('chainCodesOf drops blanks',
  chainCodesOf({ code: 'X', alias_codes: ['', '  ', 'Y'] }).length === 2)

// ── buildStockedVariantIndex ─────────────────────────────────────────────────
// Real shapes from the catalogue: 9812071480J is the aftermarket substitute for
// 9812071480 (23 on the shelf against 61 unfilled quotes), while 1920LL/1920GN
// merely share a stem and are unrelated parts.
const catalogue = [
  { code: '9812071480',  name: 'מכסה שסתומים',        stock_qty: 0 },
  { code: '9812071480J', name: 'מכסה שסתומים חליפי',  stock_qty: 23 },
  { code: '9812071480D', name: 'דיאפרגמה',            stock_qty: 4 },
  { code: '1920LL',      name: 'מש לחץ גבוהה',        stock_qty: 0 },
  { code: '1920GN',      name: 'other part',          stock_qty: 9 },
  { code: '9809162280',  name: 'תושבת מנוע',          stock_qty: 0 },
  { code: '9809162280J', name: 'תושבת חליפי',         stock_qty: 0 },   // no stock
  { code: 'ORPHANJ',     name: 'no such base',        stock_qty: 5 },
]
const vidx = buildStockedVariantIndex(catalogue)

check('indexes a stocked variant under the code it substitutes for',
  vidx.get('9812071480')?.map(v => v.code).sort().join(',') === '9812071480D,9812071480J',
  vidx.get('9812071480'))
check('orders variants by stock, biggest first',
  vidx.get('9812071480')?.[0].code === '9812071480J', vidx.get('9812071480'))
check('a shared STEM is not a variant (1920GN is not 1920LL\'s substitute)',
  !vidx.has('1920') && !vidx.has('1920LL'), [...vidx.keys()])
check('a variant with no stock is not offered', !vidx.has('9809162280'), vidx.get('9809162280'))
check('a suffixed code whose base does not exist indexes nothing',
  !vidx.has('ORPHAN'), [...vidx.keys()])
check('an unsuffixed code never indexes itself', !vidx.has('9812071480J'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
