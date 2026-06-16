import { Pool, types } from 'pg'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getSecret, initializeSecrets } from './aws-secrets'
import * as schema from './db/schema'

// Return DATE columns (OID 1082) as raw 'YYYY-MM-DD' strings instead of JS Date
// objects. The dashboard (and the former SQLite mirror) treat date columns as
// 'YYYY-MM-DD' strings — without this, pg yields Date objects that serialize to
// full ISO timestamps, breaking `new Date(dateStr + 'T00:00:00')` → Invalid Date.
types.setTypeParser(1082, (v) => v)

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
export async function query(sql: string, params?: any[]) {
  const p = await getPool()
  return p.query(sql, params)
}
