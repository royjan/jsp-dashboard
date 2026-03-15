import { Pool } from 'pg'
import { getSecret, initializeSecrets } from './aws-secrets'

let pool: Pool | null = null

export async function getDb(): Promise<Pool> {
  if (pool) return pool
  await initializeSecrets()
  const connectionString = getSecret('DATABASE_URL')
  if (!connectionString) throw new Error('DATABASE_URL not configured')
  pool = new Pool({ connectionString, max: 5 })
  return pool
}

export async function query(sql: string, params?: any[]) {
  const db = await getDb()
  return db.query(sql, params)
}
