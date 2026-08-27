import { Pool } from 'pg'
import { getSecret, initializeSecrets } from './aws-secrets'

/**
 * Read-only connection to Xpart-v2's Supabase Postgres.
 *
 * Xpart-v2 is a separate app with its own database; we are a guest there. The
 * login behind XPART_DB_URL has SELECT and nothing else, so there is no write
 * path in this module by construction — no Drizzle schema, no migrations, just
 * a query helper.
 *
 * Note there is also an unrelated XPART_DATABASE_URL in Secrets Manager that
 * points at an old Neon database. This is not that one.
 *
 * The NUMERIC/INT8/DATE type parsers set in lib/db.ts are registered globally
 * on the `pg` module, so they already apply to this pool — numerics arrive as
 * numbers here too, which is what the landed-cost math below assumes.
 */

let pool: Pool | null = null

export async function getXpartPool(): Promise<Pool> {
  if (pool) return pool
  await initializeSecrets()
  const raw = getSecret('XPART_DB_URL')
  if (!raw) throw new Error('XPART_DB_URL not configured')
  // node-postgres lets sslmode= in the connection string win over the ssl
  // option, and sslmode=require then demands a CA it does not have for
  // Supabase's pooler ("self-signed certificate in certificate chain").
  // Strip it and state the TLS policy once, in the option: encrypted, but not
  // verifying the chain -- the same thing psql's sslmode=require does.
  const url = new URL(raw)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('channel_binding')
  const connectionString = url.toString()
  pool = new Pool({
    connectionString,
    // Small on purpose: this is Supabase's shared session-mode pooler and
    // Xpart's own app connects through it too.
    max: 3,
    statement_timeout: 60_000,
    query_timeout: 65_000,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: false },
  })
  pool.on('error', (err) => console.error('[xpart-db] idle client error:', err.message))
  return pool
}

export async function xpartQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = await getXpartPool()
  const res = await p.query(sql, params)
  return res.rows as T[]
}

/**
 * Xpart is multi-tenant. Two tenants exist; all the price data belongs to
 * ג'אן חלפים בע"מ, and this id is also what makes the partial index
 * (tenant_id, part_number) WHERE is_active apply — leaving it out turns a
 * lookup into a seq scan over 2.7M rows.
 */
export const XPART_TENANT_ID = 'dbdcfba3-a590-48c5-9fcc-6e06f25b2121'
