import { Pool } from 'pg'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getSecret, initializeSecrets } from './aws-secrets'
import * as schema from './db/schema'

let pool: Pool | null = null
let _db: NodePgDatabase<typeof schema> | null = null

export async function getPool(): Promise<Pool> {
  if (pool) return pool
  await initializeSecrets()
  const connectionString = getSecret('DATABASE_URL')
  if (!connectionString) throw new Error('DATABASE_URL not configured')
  pool = new Pool({ connectionString, max: 5 })
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
