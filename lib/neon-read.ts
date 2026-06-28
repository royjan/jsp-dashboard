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
  return out
}

/** Run a read-only query against Neon Postgres. Returns { rows }. */
export async function readQueryAsync(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
  const result = await query(toPg(sql), params)
  return { rows: result.rows }
}
