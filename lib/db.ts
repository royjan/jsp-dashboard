import { Pool, types } from 'pg'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getSecret, initializeSecrets } from './aws-secrets'
import * as schema from './db/schema'

// Return DATE columns (OID 1082) as raw 'YYYY-MM-DD' strings instead of JS Date
// objects. The dashboard (and the former SQLite mirror) treat date columns as
// 'YYYY-MM-DD' strings — without this, pg yields Date objects that serialize to
// full ISO timestamps, breaking `new Date(dateStr + 'T00:00:00')` → Invalid Date.
types.setTypeParser(1082, (v) => v)

// Return NUMERIC (1700) and INT8 (20) as JS numbers instead of strings.
// node-postgres defaults these to strings for arbitrary precision, but that
// made `+` concatenate instead of add — the single most recurrent bug in this
// repo (5 confirmed instances, e.g. every item landing in ABC class A).
// Safe here: no stored bigint columns, largest NUMERIC value ~1.29M (vs
// Number.MAX_SAFE_INTEGER ~9.0e15), and nothing calls string methods on these
// columns. INT8 also covers COUNT(*)/SUM(int) results. Known trade-off:
// drizzle still types `numeric` columns as string, so those typings now lie
// in the harmless direction.
types.setTypeParser(1700, parseFloat)
types.setTypeParser(20, Number)

let pool: Pool | null = null
let _db: NodePgDatabase<typeof schema> | null = null

export async function getPool(): Promise<Pool> {
  if (pool) return pool
  await initializeSecrets()
  const connectionString = getSecret('DATABASE_URL')
  if (!connectionString) throw new Error('DATABASE_URL not configured')
  // statement_timeout: Postgres cancels any single query running longer than
  // this (ms) instead of letting it hang for minutes. query_timeout is the
  // client-side companion. Heavy analytics that legitimately need longer should
  // be optimized (e.g. vehicle-population) rather than allowed to block.
  pool = new Pool({
    connectionString,
    max: 5,
    statement_timeout: 30_000,
    query_timeout: 35_000,
  })
  return pool
}

/** Get the Drizzle ORM instance (lazy-initialized). */
export async function getDb(): Promise<NodePgDatabase<typeof schema>> {
  if (_db) return _db
  const p = await getPool()
  _db = drizzle(p, { schema })
  return _db
}

/**
 * Execute a raw SQL query against the pool.
 * Kept for backwards compatibility and complex queries
 * that are cleaner as raw SQL.
 */
/* DNS-ONLY RETRY, and the "only" is the whole design.
 *
 * Neon is reached by hostname, and the box resolves it through Docker's embedded
 * resolver. That intermittently answers `EAI_AGAIN` — observed on this container
 * while probing the demand endpoint: the request failed outright and the chart
 * rendered it as "no data", which is indistinguishable from an empty result. It
 * cleared on the next attempt.
 *
 * A generic retry here would be dangerous: `query()` runs upserts as well as
 * reads, and a connection dropped MID-statement may or may not have applied it.
 * `EAI_AGAIN` and `ENOTFOUND` are different in kind — they fail before a socket
 * exists, so the statement provably never reached Postgres and re-sending it
 * cannot double-apply anything. Nothing else is retried, deliberately.
 */
const DNS_FAILURES = new Set(['EAI_AGAIN', 'ENOTFOUND'])

function isDnsFailure(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  return !!code && DNS_FAILURES.has(code)
}

export async function query(sql: string, params?: any[]) {
  const p = await getPool()
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await p.query(sql, params)
    } catch (e) {
      if (!isDnsFailure(e)) throw e
      lastErr = e
      console.warn(
        `[db] DNS resolution failed (${(e as { code?: string }).code}), attempt ${attempt + 1}/3 — retrying`,
      )
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
    }
  }
  throw lastErr
}

/**
 * One query, on its OWN connection, with a timeout longer than the pool's.
 *
 * For the rare aggregate that legitimately cannot fit in 30s and whose result is cached
 * for a day. The pool's `statement_timeout`/`query_timeout` exist so a slow analytics
 * query cannot occupy one of five shared connections for minutes; this opens a connection
 * outside the pool instead of relaxing that guarantee for everything.
 *
 * The case that forced it: the vehicle age distribution scans all 3.78M rows of
 * ics."Vehicles" — 40.1s measured with EXPLAIN ANALYZE, because there is no index on
 * `registrationDate` alone (only a composite with `importer`). It timed out on every
 * request, and the page only ever looked alive because a cached payload from some earlier
 * run survived. ONE index on that column makes this instant and this helper unnecessary
 * for that caller.
 *
 * NEVER call this on a request path. Background refresh only, with the result cached.
 */
export async function slowQuery(sql: string, params: any[] = [], timeoutMs = 120_000) {
  const { Client } = await import('pg')
  await initializeSecrets()
  const connectionString = getSecret('DATABASE_URL')
  if (!connectionString) throw new Error('DATABASE_URL not configured')
  const client = new Client({ connectionString, statement_timeout: timeoutMs,
                              query_timeout: timeoutMs + 5_000 })
  await client.connect()
  try {
    return await client.query(sql, params)
  } finally {
    await client.end().catch(() => {})
  }
}
