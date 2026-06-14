import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'

const DB_PATH = '/tmp/dashboard-history.db'

let db: Database.Database | null = null
let syncPromise: Promise<void> | null = null
let syncDone = false

/**
 * Create and configure the SQLite database (writable for sync, then read-only queries).
 */
function openDb(): Database.Database {
  // Ensure /tmp exists (it always does, but be safe)
  const dir = path.dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const conn = new Database(DB_PATH)
  conn.pragma('journal_mode = WAL')
  conn.pragma('synchronous = OFF')  // Speed — data is ephemeral
  conn.pragma('cache_size = -32000') // 32MB cache
  conn.pragma('mmap_size = 268435456') // 256MB mmap for fast reads
  conn.function('LOG10', (x: number) => x > 0 ? Math.log10(x) : 0)
  return conn
}

/**
 * Create all SQLite tables matching the PostgreSQL schema.
 */
function createTables(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      year INTEGER NOT NULL,
      format TEXT NOT NULL,
      doc_number TEXT NOT NULL,
      status TEXT,
      new_status TEXT,
      doc_date TEXT,
      due_date TEXT,
      customer_code TEXT,
      customer_name TEXT,
      agent TEXT,
      warehouse TEXT,
      total REAL,
      vat REAL,
      grand_total REAL,
      rounding REAL,
      PRIMARY KEY (year, format, doc_number)
    );
    CREATE TABLE IF NOT EXISTS daily_sales (
      date TEXT NOT NULL PRIMARY KEY,
      revenue REAL DEFAULT 0,
      invoice_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS monthly_sales (
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT,
      quantity REAL DEFAULT 0,
      revenue REAL DEFAULT 0,
      invoice_count INTEGER DEFAULT 0,
      season TEXT,
      PRIMARY KEY (year, month, item_code)
    );
    CREATE TABLE IF NOT EXISTS customer_stats (
      year INTEGER NOT NULL,
      customer_code TEXT NOT NULL,
      customer_name TEXT,
      invoice_count INTEGER DEFAULT 0,
      total_revenue REAL DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      open_balance REAL DEFAULT 0,
      last_invoice TEXT,
      PRIMARY KEY (year, customer_code)
    );
    CREATE TABLE IF NOT EXISTS item_snapshot (
      item_code TEXT NOT NULL,
      item_name TEXT,
      qty REAL DEFAULT 0,
      ordered_qty REAL DEFAULT 0,
      incoming_qty REAL DEFAULT 0,
      sold_this_year REAL DEFAULT 0,
      sold_last_year REAL DEFAULT 0,
      sold_2y_ago REAL DEFAULT 0,
      sold_3y_ago REAL DEFAULT 0,
      retail_price REAL DEFAULT 0,
      warehouse TEXT,
      place TEXT,
      update_date TEXT,
      snapshot_at TEXT,
      PRIMARY KEY (item_code)
    );
    CREATE TABLE IF NOT EXISTS format_summary (
      year INTEGER NOT NULL,
      format TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      total REAL DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      open_total REAL DEFAULT 0,
      PRIMARY KEY (year, format)
    );
    CREATE TABLE IF NOT EXISTS etl_log (
      year INTEGER NOT NULL PRIMARY KEY,
      doc_count INTEGER DEFAULT 0,
      loaded_at TEXT
    );
  `)
}

/**
 * Bulk-copy a table from PostgreSQL into SQLite.
 * Fetches all rows in a single PG query and inserts via a transaction.
 */
async function syncTable(
  conn: Database.Database,
  pgQuery: (sql: string, params?: any[]) => Promise<{ rows: any[] }>,
  tableName: string,
  pgSql: string,
  columns: string[],
): Promise<number> {
  const result = await pgQuery(pgSql)
  if (!result.rows.length) return 0

  const placeholders = columns.map(() => '?').join(', ')
  const insert = conn.prepare(
    `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
  )

  const tx = conn.transaction((rows: any[]) => {
    for (const row of rows) {
      insert.run(...columns.map(col => row[col] ?? null))
    }
  })
  tx(result.rows)

  return result.rows.length
}

/**
 * Sync all tables from PostgreSQL (Neon) into the local SQLite database.
 * Called once per container startup.
 */
export async function syncSqliteFromPg(): Promise<void> {
  if (syncDone) return

  const start = Date.now()
  console.log('[SQLite] Starting sync from PostgreSQL...')

  // Lazy-import to avoid circular deps and keep PG connection lazy
  const { query: pgQuery } = await import('./db')

  const conn = openDb()
  createTables(conn)

  const counts: Record<string, number> = {}

  // Sync documents
  counts.documents = await syncTable(conn, pgQuery, 'documents',
    `SELECT year, format, doc_number, status, new_status,
            doc_date::text, due_date::text, customer_code, customer_name,
            agent, warehouse, total::float, vat::float, grand_total::float, rounding::float
     FROM dashboard.documents`,
    ['year', 'format', 'doc_number', 'status', 'new_status', 'doc_date', 'due_date',
     'customer_code', 'customer_name', 'agent', 'warehouse', 'total', 'vat', 'grand_total', 'rounding'],
  )

  // Sync daily_sales
  counts.daily_sales = await syncTable(conn, pgQuery, 'daily_sales',
    `SELECT date::text, revenue::float, invoice_count FROM dashboard.daily_sales`,
    ['date', 'revenue', 'invoice_count'],
  )

  // Sync monthly_sales
  counts.monthly_sales = await syncTable(conn, pgQuery, 'monthly_sales',
    `SELECT year, month, item_code, item_name, quantity::float, revenue::float, invoice_count, season
     FROM dashboard.monthly_sales`,
    ['year', 'month', 'item_code', 'item_name', 'quantity', 'revenue', 'invoice_count', 'season'],
  )

  // Sync customer_stats (may or may not exist in PG — handle gracefully)
  try {
    counts.customer_stats = await syncTable(conn, pgQuery, 'customer_stats',
      `SELECT year, customer_code, customer_name, invoice_count,
              total_revenue::float, open_count, open_balance::float, last_invoice::text
       FROM dashboard.customer_stats`,
      ['year', 'customer_code', 'customer_name', 'invoice_count',
       'total_revenue', 'open_count', 'open_balance', 'last_invoice'],
    )
  } catch (e: any) {
    console.warn('[SQLite] customer_stats sync skipped (table may not exist in PG):', e.message?.substring(0, 100))
    counts.customer_stats = 0
  }

  // Sync item_snapshot from PG item_snapshots (column mapping differs)
  try {
    counts.item_snapshot = await syncTable(conn, pgQuery, 'item_snapshot',
      `SELECT item_code, item_name,
              stock_qty::float AS qty,
              0 AS ordered_qty, 0 AS incoming_qty,
              sold_this_year::float, sold_last_year::float,
              0 AS sold_2y_ago, 0 AS sold_3y_ago,
              price::float AS retail_price,
              '' AS warehouse, '' AS place,
              update_date, snapshot_date::text AS snapshot_at
       FROM dashboard.item_snapshots
       WHERE (item_code, snapshot_date) IN (
         SELECT item_code, MAX(snapshot_date) FROM dashboard.item_snapshots GROUP BY item_code
       )`,
      ['item_code', 'item_name', 'qty', 'ordered_qty', 'incoming_qty',
       'sold_this_year', 'sold_last_year', 'sold_2y_ago', 'sold_3y_ago',
       'retail_price', 'warehouse', 'place', 'update_date', 'snapshot_at'],
    )
  } catch (e: any) {
    console.warn('[SQLite] item_snapshot sync skipped:', e.message?.substring(0, 100))
    counts.item_snapshot = 0
  }

  // Sync format_summary
  try {
    counts.format_summary = await syncTable(conn, pgQuery, 'format_summary',
      `SELECT year, format, count, total::float, open_count, open_total::float
       FROM dashboard.format_summary`,
      ['year', 'format', 'count', 'total', 'open_count', 'open_total'],
    )
  } catch (e: any) {
    console.warn('[SQLite] format_summary sync skipped (table may not exist in PG):', e.message?.substring(0, 100))
    counts.format_summary = 0
  }

  // Create indexes for query performance
  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_docs_format_date ON documents (format, doc_date);
    CREATE INDEX IF NOT EXISTS idx_docs_customer ON documents (customer_code, doc_date);
    CREATE INDEX IF NOT EXISTS idx_monthly_year_month ON monthly_sales (year, month);
    CREATE INDEX IF NOT EXISTS idx_monthly_item ON monthly_sales (item_code);
    CREATE INDEX IF NOT EXISTS idx_item_snapshot_code ON item_snapshot (item_code);
    CREATE INDEX IF NOT EXISTS idx_customer_stats_year ON customer_stats (year);
  `)

  // Store the open connection for queries
  db = conn

  syncDone = true
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[SQLite] Sync complete in ${elapsed}s:`, counts)
}

/**
 * Ensure the SQLite DB is synced and ready. Returns the connection.
 * On first call triggers the PG→SQLite sync; subsequent calls return immediately.
 */
async function ensureDb(): Promise<Database.Database | null> {
  if (db && syncDone) return db

  // Deduplicate concurrent sync requests
  if (!syncPromise) {
    syncPromise = syncSqliteFromPg().catch(err => {
      console.error('[SQLite] Sync failed:', err)
      syncPromise = null
      // Try to open existing /tmp DB if sync partially completed
      if (existsSync(DB_PATH) && !db) {
        try {
          db = openDb()
          console.log('[SQLite] Opened partially-synced DB')
        } catch {}
      }
    })
  }

  await syncPromise
  return db
}

/**
 * Execute a read query against the local SQLite database.
 * Accepts PostgreSQL-style $1, $2 placeholders and casts (::text, ::numeric, ::int).
 * Returns { rows: [...] } matching the pg query interface.
 *
 * NOTE: This is now async on first call (triggers PG sync), but returns synchronously
 * on subsequent calls. For backward compat we keep the sync signature and handle
 * the async init internally.
 */
export function readQuery(sql: string, params?: any[]): { rows: any[] } {
  // If DB is already synced, run synchronously (hot path)
  if (db && syncDone) {
    return executeQuery(db, sql, params)
  }

  // DB not ready yet — trigger sync in background and return empty
  // The sync will complete and subsequent calls will work
  if (!syncPromise) {
    syncPromise = syncSqliteFromPg().catch(err => {
      console.error('[SQLite] Background sync failed:', err)
      syncPromise = null
    })
  }

  // If the DB file already exists from a partial/previous sync, try to use it
  if (!db && existsSync(DB_PATH)) {
    try {
      db = openDb()
      return executeQuery(db, sql, params)
    } catch {
      return { rows: [] }
    }
  }

  console.warn('[SQLite] DB not ready yet (sync in progress), returning empty result')
  return { rows: [] }
}

/**
 * Async version of readQuery — waits for sync to complete before querying.
 * Use this in contexts where you can await (API routes, server components).
 */
export async function readQueryAsync(sql: string, params?: any[]): Promise<{ rows: any[] }> {
  const conn = await ensureDb()
  if (!conn) return { rows: [] }
  return executeQuery(conn, sql, params)
}

/**
 * Internal: execute a query against an open SQLite connection.
 */
function executeQuery(sqlite: Database.Database, sql: string, params?: any[]): { rows: any[] } {
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
  if (converted.includes('= ANY(?)') && params) {
    const anyIdx = converted.indexOf('= ANY(?)')
    let qIdx = 0
    for (let i = 0; i < anyIdx; i++) {
      if (converted[i] === '?') qIdx++
    }
    const arrayParam = params[qIdx]
    if (Array.isArray(arrayParam)) {
      const placeholders = arrayParam.map(() => '?').join(', ')
      converted = converted.replace('= ANY(?)', `IN (${placeholders})`)
      params = [...params.slice(0, qIdx), ...arrayParam, ...params.slice(qIdx + 1)]
    }
  }

  // PostgreSQL DISTINCT ON → not supported in SQLite
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
  syncDone = false
  syncPromise = null
}
