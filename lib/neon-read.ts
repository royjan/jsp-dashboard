/**
 * Postgres query helper.
 *
 * Formerly a local SQLite mirror of Neon (synced on startup) — that mirror was
 * the staleness trap (a warm wrote Neon but SQLite only re-synced on restart).
 * The dashboard now reads **Neon Postgres directly**. Analytics results are
 * cached in Redis (db1), so a Postgres read only happens on a cache miss / warm
 * — not the hot path — so the local-read optimization SQLite gave isn't needed.
 *
 * Queries in the codebase are a mix of Postgres-style ($1, dashboard.*, EXTRACT)
 * and SQLite-style (?, bare tables, strftime). `toPg()` normalizes the
 * SQLite-isms to Postgres; Postgres-style SQL passes through unchanged.
 */
import { query } from './db'

const DASHBOARD_TABLES = [
  'monthly_sales', 'daily_sales', 'item_snapshots', 'customer_stats', 'documents', 'format_summary',
  'yearly_item_sales',
]

/** Normalize SQLite-style SQL to Postgres (idempotent on Postgres-style SQL). */
export function toPg(sql: string): string {
  let out = sql
    // strftime('%Y'|'%m', X) → EXTRACT(... FROM X)::int
    .replace(/strftime\(\s*'%Y'\s*,\s*([^)]+?)\s*\)/gi, 'EXTRACT(YEAR FROM $1)::int')
    .replace(/strftime\(\s*'%m'\s*,\s*([^)]+?)\s*\)/gi, 'EXTRACT(MONTH FROM $1)::int')

  // Qualify bare dashboard.* tables (only matches unqualified ones — a
  // "dashboard." prefix shifts the char after FROM/JOIN so the alt won't match).
  const tbls = DASHBOARD_TABLES.join('|')
  out = out.replace(
    new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+(${tbls})\\b`, 'gi'),
    (_m, kw, tbl) => `${kw} dashboard.${tbl}`,
  )

  // Positional ?-params → $1, $2, … (SQLite → Postgres). No-op if none.
  let i = 0
  out = out.replace(/\?/g, () => `$${++i}`)

  assertNoUntranslatedSqlite(out)
  return out
}

/**
 * Refuse a query this shim did not fully translate, instead of handing Postgres
 * something it will reject with a message about syntax near "strftime".
 *
 * The point is WHICH failure the caller sees. Every caller of readQueryAsync
 * wraps it in a catch that returns [] (see safeQuery in the business-report
 * route), so an untranslated query does not surface as an error — it surfaces
 * as an empty result, which on a revenue card is indistinguishable from "we
 * sold nothing". Throwing something self-describing means the failure at least
 * lands in query_failures with a sentence a human can act on.
 *
 * This detects, it does not translate. Adding cases to the translator is the
 * wrong direction — new code should write plain Postgres.
 */
function assertNoUntranslatedSqlite(sql: string): void {
  const leftovers: Array<[RegExp, string]> = [
    [/\bstrftime\s*\(/i, "strftime() — only '%Y' and '%m' are translated; use EXTRACT()"],
    [/\bdatetime\s*\(/i, 'datetime() — use a Postgres timestamp expression'],
    [/\bjulianday\s*\(/i, 'julianday() — subtract dates directly in Postgres'],
    [/\bifnull\s*\(/i, 'ifnull() — use COALESCE()'],
    [/\bgroup_concat\s*\(/i, 'group_concat() — use string_agg()'],
    [/\|\|\s*''/, "SQLite string concat against '' — check this is intentional in Postgres"],
    [/\b(MIN|MAX)\s*\([^()]*,[^()]*\)/i, 'two-argument MIN()/MAX() — use LEAST()/GREATEST()'],
  ]
  for (const [re, why] of leftovers) {
    if (re.test(sql)) {
      throw new Error(
        `toPg cannot translate this query: ${why}. ` +
          `Rewrite it as plain Postgres rather than extending the shim. ` +
          `SQL began: ${sql.trim().split('\n')[0].slice(0, 120)}`,
      )
    }
  }
}

/** Run a read-only query against Neon Postgres. Returns { rows }. */
export async function readQueryAsync(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
  const result = await query(toPg(sql), params)
  return { rows: result.rows }
}
