#!/usr/bin/env node

/**
 * Export PostgreSQL dashboard data to SQLite and upload to S3.
 *
 * Usage: node scripts/export-to-sqlite.js [--upload]
 *   --upload  Upload the resulting .db file to S3 after export
 */

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')
const { Pool } = require('pg')
const Database = require('better-sqlite3')
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// Fix reversed Latin/digit sequences in Hebrew item names from Finansit RTL input
function fixRtlItemName(name) {
  if (!name) return name
  if (!/[\u0590-\u05FF]/.test(name)) return name
  return name.replace(/[A-Za-z0-9]+/g, (match) => match.split('').reverse().join(''))
}

const S3_BUCKET = 'jsp-db-backup'
const S3_KEY = 'jan-parts-dashboard/dashboard-history.db'
const DB_PATH = path.join(__dirname, '..', 'data', 'dashboard-history.db')
const BATCH_SIZE = 5000

async function getDatabaseUrl() {
  const client = new SecretsManagerClient({ region: 'eu-central-1' })
  const resp = await client.send(new GetSecretValueCommand({ SecretId: 'config' }))
  const secrets = JSON.parse(resp.SecretString)
  return secrets.DATABASE_URL
}

function createSqliteSchema(db) {
  db.exec(`
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
      invoice_count INTEGER,
      total_revenue REAL,
      open_count INTEGER,
      open_balance REAL,
      last_invoice TEXT,
      PRIMARY KEY (year, customer_code)
    );

    CREATE TABLE IF NOT EXISTS item_snapshot (
      item_code TEXT NOT NULL PRIMARY KEY,
      item_name TEXT,
      qty REAL,
      ordered_qty REAL,
      incoming_qty REAL,
      sold_this_year REAL,
      sold_last_year REAL,
      sold_2y_ago REAL,
      sold_3y_ago REAL,
      retail_price REAL,
      warehouse TEXT,
      place TEXT,
      update_date TEXT,
      snapshot_at TEXT
    );

    CREATE TABLE IF NOT EXISTS format_summary (
      year INTEGER NOT NULL,
      format TEXT NOT NULL,
      count INTEGER,
      total REAL,
      open_count INTEGER,
      open_total REAL,
      PRIMARY KEY (year, format)
    );

    CREATE TABLE IF NOT EXISTS etl_log (
      year INTEGER NOT NULL PRIMARY KEY,
      doc_count INTEGER NOT NULL,
      loaded_at TEXT
    );

    -- Indexes matching the PostgreSQL setup
    CREATE INDEX IF NOT EXISTS idx_documents_format_date ON documents (format, doc_date);
    CREATE INDEX IF NOT EXISTS idx_documents_customer_date ON documents (customer_code, doc_date) WHERE format = '11';
    CREATE INDEX IF NOT EXISTS idx_daily_sales_date ON daily_sales (date);
    CREATE INDEX IF NOT EXISTS idx_monthly_sales_year_month ON monthly_sales (year, month);
    CREATE INDEX IF NOT EXISTS idx_customer_stats_year ON customer_stats (year);
    CREATE INDEX IF NOT EXISTS idx_documents_year ON documents (year);
  `)
}

async function exportTable(pgPool, sqliteDb, tableName, pgQuery, insertSql, mapRow) {
  const startTime = Date.now()
  console.log(`\n[${tableName}] Exporting...`)

  const pgResult = await pgPool.query(pgQuery)
  const rows = pgResult.rows
  console.log(`[${tableName}] Fetched ${rows.length} rows from PostgreSQL (${Date.now() - startTime}ms)`)

  if (rows.length === 0) return 0

  const insert = sqliteDb.prepare(insertSql)
  const insertMany = sqliteDb.transaction((batch) => {
    for (const row of batch) {
      insert.run(mapRow(row))
    }
  })

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    insertMany(batch)
    if (rows.length > BATCH_SIZE) {
      process.stdout.write(`\r[${tableName}] Inserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`)
    }
  }

  if (rows.length > BATCH_SIZE) process.stdout.write('\n')
  console.log(`[${tableName}] Done (${Date.now() - startTime}ms)`)
  return rows.length
}

function toDateStr(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().split('T')[0]
  return String(val).split('T')[0]
}

function toTimestampStr(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

async function main() {
  const shouldUpload = process.argv.includes('--upload')

  console.log('=== PostgreSQL → SQLite Export ===\n')

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH)
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  // Remove existing DB file
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH)
    console.log('Removed existing SQLite file')
  }

  // Connect to PostgreSQL
  console.log('Connecting to PostgreSQL...')
  const dbUrl = await getDatabaseUrl()
  const pgPool = new Pool({ connectionString: dbUrl, max: 3 })

  // Create SQLite
  console.log(`Creating SQLite at: ${DB_PATH}`)
  const sqliteDb = new Database(DB_PATH)
  sqliteDb.pragma('journal_mode = WAL')
  sqliteDb.pragma('synchronous = OFF') // Safe for bulk insert, will set to NORMAL after
  sqliteDb.pragma('cache_size = -64000') // 64MB cache for fast inserts

  createSqliteSchema(sqliteDb)

  const totalStart = Date.now()
  let totalRows = 0

  // 1. Documents (biggest table - 650K rows)
  totalRows += await exportTable(
    pgPool, sqliteDb, 'documents',
    'SELECT * FROM dashboard.documents ORDER BY year, format, doc_number',
    `INSERT OR REPLACE INTO documents (year, format, doc_number, status, new_status, doc_date, due_date, customer_code, customer_name, agent, warehouse, total, vat, grand_total, rounding)
     VALUES (@year, @format, @doc_number, @status, @new_status, @doc_date, @due_date, @customer_code, @customer_name, @agent, @warehouse, @total, @vat, @grand_total, @rounding)`,
    (r) => ({
      year: r.year,
      format: r.format,
      doc_number: r.doc_number,
      status: r.status,
      new_status: r.new_status,
      doc_date: toDateStr(r.doc_date),
      due_date: toDateStr(r.due_date),
      customer_code: r.customer_code,
      customer_name: r.customer_name,
      agent: r.agent,
      warehouse: r.warehouse,
      total: Number(r.total) || 0,
      vat: Number(r.vat) || 0,
      grand_total: Number(r.grand_total) || 0,
      rounding: Number(r.rounding) || 0,
    })
  )

  // 2. Daily sales
  totalRows += await exportTable(
    pgPool, sqliteDb, 'daily_sales',
    'SELECT * FROM dashboard.daily_sales ORDER BY date',
    'INSERT OR REPLACE INTO daily_sales (date, revenue, invoice_count) VALUES (@date, @revenue, @invoice_count)',
    (r) => ({
      date: toDateStr(r.date),
      revenue: Number(r.revenue) || 0,
      invoice_count: r.invoice_count || 0,
    })
  )

  // 3. Monthly sales
  totalRows += await exportTable(
    pgPool, sqliteDb, 'monthly_sales',
    'SELECT * FROM dashboard.monthly_sales ORDER BY year, month, item_code',
    `INSERT OR REPLACE INTO monthly_sales (year, month, item_code, item_name, quantity, revenue, invoice_count, season)
     VALUES (@year, @month, @item_code, @item_name, @quantity, @revenue, @invoice_count, @season)`,
    (r) => ({
      year: r.year,
      month: r.month,
      item_code: r.item_code,
      item_name: fixRtlItemName(r.item_name),
      quantity: Number(r.quantity) || 0,
      revenue: Number(r.revenue) || 0,
      invoice_count: r.invoice_count || 0,
      season: r.season,
    })
  )

  // 4. Customer stats
  totalRows += await exportTable(
    pgPool, sqliteDb, 'customer_stats',
    'SELECT * FROM dashboard.customer_stats ORDER BY year, customer_code',
    `INSERT OR REPLACE INTO customer_stats (year, customer_code, customer_name, invoice_count, total_revenue, open_count, open_balance, last_invoice)
     VALUES (@year, @customer_code, @customer_name, @invoice_count, @total_revenue, @open_count, @open_balance, @last_invoice)`,
    (r) => ({
      year: r.year,
      customer_code: r.customer_code,
      customer_name: r.customer_name,
      invoice_count: r.invoice_count || 0,
      total_revenue: Number(r.total_revenue) || 0,
      open_count: r.open_count || 0,
      open_balance: Number(r.open_balance) || 0,
      last_invoice: toDateStr(r.last_invoice),
    })
  )

  // 5. Item snapshot (latest full snapshot)
  totalRows += await exportTable(
    pgPool, sqliteDb, 'item_snapshot',
    'SELECT * FROM dashboard.item_snapshot ORDER BY item_code',
    `INSERT OR REPLACE INTO item_snapshot (item_code, item_name, qty, ordered_qty, incoming_qty, sold_this_year, sold_last_year, sold_2y_ago, sold_3y_ago, retail_price, warehouse, place, update_date, snapshot_at)
     VALUES (@item_code, @item_name, @qty, @ordered_qty, @incoming_qty, @sold_this_year, @sold_last_year, @sold_2y_ago, @sold_3y_ago, @retail_price, @warehouse, @place, @update_date, @snapshot_at)`,
    (r) => ({
      item_code: r.item_code,
      item_name: fixRtlItemName(r.item_name),
      qty: Number(r.qty) || 0,
      ordered_qty: Number(r.ordered_qty) || 0,
      incoming_qty: Number(r.incoming_qty) || 0,
      sold_this_year: Number(r.sold_this_year) || 0,
      sold_last_year: Number(r.sold_last_year) || 0,
      sold_2y_ago: Number(r.sold_2y_ago) || 0,
      sold_3y_ago: Number(r.sold_3y_ago) || 0,
      retail_price: Number(r.retail_price) || 0,
      warehouse: r.warehouse,
      place: r.place,
      update_date: toDateStr(r.update_date),
      snapshot_at: toTimestampStr(r.snapshot_at),
    })
  )

  // 6. Format summary
  totalRows += await exportTable(
    pgPool, sqliteDb, 'format_summary',
    'SELECT * FROM dashboard.format_summary ORDER BY year, format',
    `INSERT OR REPLACE INTO format_summary (year, format, count, total, open_count, open_total)
     VALUES (@year, @format, @count, @total, @open_count, @open_total)`,
    (r) => ({
      year: r.year,
      format: r.format,
      count: r.count || 0,
      total: Number(r.total) || 0,
      open_count: r.open_count || 0,
      open_total: Number(r.open_total) || 0,
    })
  )

  // 7. ETL log
  totalRows += await exportTable(
    pgPool, sqliteDb, 'etl_log',
    'SELECT * FROM dashboard.etl_log ORDER BY year',
    'INSERT OR REPLACE INTO etl_log (year, doc_count, loaded_at) VALUES (@year, @doc_count, @loaded_at)',
    (r) => ({
      year: r.year,
      doc_count: r.doc_count,
      loaded_at: toTimestampStr(r.loaded_at),
    })
  )

  // Finalize SQLite
  sqliteDb.pragma('synchronous = NORMAL')
  sqliteDb.exec('ANALYZE') // Build query planner statistics
  sqliteDb.close()

  await pgPool.end()

  const fileSize = fs.statSync(DB_PATH).size
  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1)

  console.log('\n=== Export Complete ===')
  console.log(`Total rows: ${totalRows.toLocaleString()}`)
  console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`)
  console.log(`Time: ${elapsed}s`)
  console.log(`Path: ${DB_PATH}`)

  // Upload to S3
  if (shouldUpload) {
    console.log(`\nUploading to s3://${S3_BUCKET}/${S3_KEY}...`)
    execSync(`aws s3 cp "${DB_PATH}" "s3://${S3_BUCKET}/${S3_KEY}" --region eu-central-1`, { stdio: 'inherit' })
    console.log('Upload complete!')
  } else {
    console.log(`\nTo upload to S3: node scripts/export-to-sqlite.js --upload`)
  }
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
