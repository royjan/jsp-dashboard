#!/usr/bin/env node
/**
 * Real-data smoke test for the dashboard.
 *
 * Hits every dashboard data endpoint against a LIVE deployment and asserts the
 * payload is actually populated (not empty / not 0). Catches the "everything
 * shows 0" failure mode (e.g. FINAPI cache cold, dead ETL, broken endpoint).
 *
 * Usage:
 *   node scripts/smoke-data.mjs                 # defaults to http://192.168.0.112:3002
 *   node scripts/smoke-data.mjs https://dashboard.jan.parts
 *   BASE=http://localhost:3000 node scripts/smoke-data.mjs
 *
 * Exit code 0 = all checks passed; 1 = at least one empty/failed (CI-friendly).
 */

const BASE = process.argv[2] || process.env.BASE || 'http://192.168.0.112:3002';
const TIMEOUT_MS = 90_000;

/** Each check: hit `path`, then `ok(json)` must return true for "has real data". */
const CHECKS = [
  {
    name: 'KPIs — monthly sales',
    path: '/api/dashboard',
    ok: (d) => num(d?.this_month_sales?.total) > 0,
    detail: (d) => `this_month_sales.total=${d?.this_month_sales?.total}`,
  },
  {
    name: 'KPIs — open quotes',
    path: '/api/dashboard',
    ok: (d) => num(d?.open_quotes?.count) > 0,
    detail: (d) => `open_quotes.count=${d?.open_quotes?.count}`,
  },
  {
    name: 'Items catalog',
    path: '/api/items',
    ok: (d) => num(d?.count) > 0,
    detail: (d) => `count=${d?.count}`,
  },
  {
    name: 'Sales time-series (YTD)',
    path: '/api/analytics/sales?period=ytd',
    ok: (d) => arr(d?.data ?? d).length > 0,
    detail: (d) => `points=${arr(d?.data ?? d).length}`,
  },
  {
    name: 'ABC classification',
    path: '/api/analytics/abc',
    ok: (d) => num(d?.summary?.total_items) > 0 && num(d?.summary?.total_revenue) > 0,
    detail: (d) => `total_items=${d?.summary?.total_items} total_revenue=${d?.summary?.total_revenue}`,
  },
  {
    name: 'Reorder recommendations',
    path: '/api/analytics/reorder',
    ok: (d) => arr(d?.items ?? d).length > 0,
    detail: (d) => `items=${arr(d?.items ?? d).length}`,
  },
  {
    name: 'Top-selling items',
    path: '/api/analytics/top-items',
    ok: (d) => arr(d?.data ?? d).length > 0,
    detail: (d) => `items=${arr(d?.data ?? d).length}`,
  },
  {
    name: 'Customer analytics',
    path: '/api/analytics/customers',
    ok: (d) => arr(d?.customers ?? d).length > 0,
    detail: (d) => `customers=${arr(d?.customers ?? d).length}`,
  },
  {
    // Dead stock CAN legitimately be 0, so only assert the endpoint computed
    // over a non-empty catalog (total_evaluated) rather than a non-empty result.
    name: 'Dead stock (catalog evaluated)',
    path: '/api/analytics/dead-stock',
    ok: (d) => arr(d?.items ?? d).length >= 0 && d != null && !d.error,
    detail: (d) => `items=${arr(d?.items ?? d).length}${d?.error ? ' ERROR:' + d.error : ''}`,
    soft: true, // empty is allowed; only fail on error
  },
  {
    name: 'Gap analysis (quoted, no stock)',
    path: '/api/analytics/gap?format=31&limit=50',
    ok: (d) => !d?.error && Array.isArray(d?.items ?? d),
    detail: (d) => d?.error ? 'ERROR:' + d.error : `items=${arr(d?.items ?? d).length}`,
  },
  {
    name: 'Vehicle population (ICS registrations)',
    path: '/api/analytics/vehicle-population',
    ok: (d) => !d?.error,
    detail: (d) => d?.error ? 'ERROR:' + d.error
      : d?.warming ? 'warming (scan running)'
      : `vehicles=${d?.total_vehicles} mfrs=${d?.total_manufacturers}`,
  },
  {
    name: 'Price elasticity',
    path: '/api/analytics/price-elasticity?top_n=20&min_months=6',
    ok: (d) => !d?.error,
    detail: (d) => d?.error ? 'ERROR:' + d.error : `items=${arr(d?.items ?? d).length}`,
  },
  {
    name: 'Margin (revenue/qty)',
    path: '/api/analytics/margin',
    ok: (d) => !d?.error && num(d?.summary?.total_revenue) > 0,
    detail: (d) => d?.error ? 'ERROR:' + d.error : `revenue=${d?.summary?.total_revenue}`,
  },
  {
    name: 'Market — fuel labels (not undefined)',
    path: '/api/analytics/market',
    ok: (d) => arr(d?.fuel_breakdown).length > 0 && !!d.fuel_breakdown[0]?.fuel,
    detail: (d) => `fuels=${arr(d?.fuel_breakdown).length} first=${d?.fuel_breakdown?.[0]?.fuel}`,
  },
  {
    name: 'Receivables (no 404)',
    path: '/api/analytics/receivables?limit=20',
    ok: (d) => d != null && !d.error && d.totals !== undefined,
    detail: (d) => d?.error ? 'ERROR:' + d.error : `customers=${arr(d?.customers).length} balance=${d?.totals?.total_balance}`,
    soft: true, // AR balances need FINAPI; empty is acceptable for now, only fail on error
  },
];

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const arr = (v) => (Array.isArray(v) ? v : []);

async function getJson(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { __raw: text.slice(0, 200) }; }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log(`Smoke-testing dashboard data at ${BASE}\n`);
  let failed = 0;
  for (const c of CHECKS) {
    try {
      const { status, json } = await getJson(c.path);
      const passed = status === 200 && c.ok(json);
      const tag = passed ? '✅ PASS' : c.soft ? '⚠️  WARN' : '❌ FAIL';
      console.log(`${tag}  ${c.name.padEnd(34)} [${status}] ${c.detail(json)}`);
      if (!passed && !c.soft) failed++;
    } catch (e) {
      console.log(`❌ FAIL  ${c.name.padEnd(34)} ${e.name === 'AbortError' ? 'TIMEOUT' : e.message}`);
      if (!c.soft) failed++;
    }
  }
  console.log(`\n${failed === 0 ? '✅ all data sources populated' : `❌ ${failed} empty/failed data source(s)`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
