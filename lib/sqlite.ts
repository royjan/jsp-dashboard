import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data', 'dashboard-history.db')

let db: Database.Database | null = null

function ensureDb(): Database.Database | null {
  if (db) return db

  if (!existsSync(DB_PATH)) {
    console.warn(`[SQLite] Database not found at ${DB_PATH}`)
    return null
  }

  db = new Database(DB_PATH, { readonly: true })
  db.pragma('cache_size = -32000') // 32MB cache
  db.pragma('mmap_size = 268435456') // 256MB mmap for fast reads
  db.function('LOG10', (x: number) => x > 0 ? Math.log10(x) : 0)
  console.log(`[SQLite] Opened ${DB_PATH}`)
  return db
}

/**
 * Execute a read query against the local SQLite database.
 * Accepts PostgreSQL-style $1, $2 placeholders and casts (::text, ::numeric, ::int).
 * Returns { rows: [...] } matching the pg query interface.
 */
export function readQuery(sql: string, params?: any[]): { rows: any[] } {
  const sqlite = ensureDb()
  if (!sqlite) return { rows: [] }

  // Convert PostgreSQL syntax to SQLite
  let converted = sql
    // Remove schema prefix
    .replace(/dashboard\./g, '')
    // Remove PostgreSQL type casts
    .replace(/::(?:text|numeric|int|integer|bigint|float|double precision|date)\b/gi, '')
    // Convert $1, $2 etc. to ?
    .replace(/\$\d+/g, '?')
    // EXTRACT(YEAR FROM col) → CAST(strftime('%Y', col) AS INTEGER)
    .replace(/EXTRACT\s*\(\s*YEAR\s+FROM\s+(\w+)\s*\)/gi, "CAST(strftime('%Y', $1) AS INTEGER)")
    .replace(/EXTRACT\s*\(\s*MONTH\s+FROM\s+(\w+)\s*\)/gi, "CAST(strftime('%m', $1) AS INTEGER)")

  // PostgreSQL ANY($1) with array param → SQLite IN (?, ?, ...)
  // Detect pattern: col = ANY(?) and expand the array parameter
  if (converted.includes('= ANY(?)') && params) {
    const anyIdx = converted.indexOf('= ANY(?)')
    // Find which ? this corresponds to
    let qIdx = 0
    for (let i = 0; i < anyIdx; i++) {
      if (converted[i] === '?') qIdx++
    }
    const arrayParam = params[qIdx]
    if (Array.isArray(arrayParam)) {
      const placeholders = arrayParam.map(() => '?').join(', ')
      converted = converted.replace('= ANY(?)', `IN (${placeholders})`)
      // Expand the array in params
      params = [...params.slice(0, qIdx), ...arrayParam, ...params.slice(qIdx + 1)]
    }
  }

  // PostgreSQL DISTINCT ON → not supported in SQLite, use GROUP BY workaround
  // "SELECT DISTINCT ON (col) col, other FROM t ORDER BY col, x DESC"
  // Just remove DISTINCT ON (...) and let GROUP BY handle it
  converted = converted.replace(/DISTINCT\s+ON\s*\([^)]+\)\s*/gi, '')

  try {
    const stmt = sqlite.prepare(converted)
    const rows = stmt.all(...(params || []))
    return { rows }
  } catch (e: any) {
    console.error('[SQLite] Query failed:', e.message)
    console.error('[SQLite] SQL:', converted)
    console.error('[SQLite] Params:', params)
    throw e
  }
}

/**
 * Close the SQLite database connection (for cleanup).
 */
export function closeSqlite(): void {
  if (db) {
    db.close()
    db = null
  }
}
