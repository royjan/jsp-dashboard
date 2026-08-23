/**
 * Rebuild dashboard.monthly_sales from documents ALREADY IN POSTGRES.
 *
 *   node scripts/backfill-monthly-sales.mjs           # dry run — prints the months, writes nothing
 *   node scripts/backfill-monthly-sales.mjs --write   # applies it
 *
 * WHY THIS EXISTS. monthly_sales held 2026 only — 8,058 rows — while every per-item monthly
 * analysis (seasonal, ABC, stock-forecast demand rates, price elasticity) reads it and
 * silently became a single-year view. The obvious fix was to re-run /api/sync?mode=historical
 * for 20-30 months against FINAPI. It was not necessary: `dashboard.document_lines` joined to
 * `dashboard.documents` (which does carry doc_date) already holds 99k invoice lines spanning
 * Feb 2023 -> May 2026. The months were in the database the whole time, in a different table.
 *
 * Validated against the months where both exist before it was run: derived 1,011,721 vs
 * stored 959,640 (2026-02) and 1,020,225 vs 1,028,077 (2026-03) — the derivation reproduces
 * what the sync writes.
 *
 * Two rules earn their keep:
 *  · MIN_LINES — 2024-01..07 hold 1 to 56 invoice lines each, the document sync catching up.
 *    Importing them would put a "month" of four sales beside a real one on a seasonal chart.
 *  · the stub test — July 2025 was NOT missing from monthly_sales; it was 30 rows / 22,142
 *    over a month whose own document lines total 8,136 lines / 2,505,168. "Does the month
 *    exist" would have preserved it. Anything holding at least half its derived revenue is
 *    left alone, which is what protects 2026-04 and 2026-05: their document lines carry no
 *    line_total while the live sync wrote the real figures.
 *
 * Idempotent (upsert on year+month+item_code), so re-running after the next document sync
 * picks up whatever it added. Applied 2026-08-23: 18 months, 18,987 rows.
 */
import fs from 'fs'; import pg from 'pg'
const url = fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim()
const c = new pg.Client({ connectionString: url, statement_timeout: 180000 }); await c.connect()
const DRY = process.argv[2] !== '--write'
// Months worth calling months: at least MIN_LINES invoice lines. 2024-01..08 ramp from 1 to
// 107 lines as the document sync was catching up — importing those would put a "month" of
// four sales next to a real one on a seasonal chart.
const MIN_LINES = 100
const sql = `
WITH derived AS (
  SELECT EXTRACT(YEAR FROM d.doc_date)::int  AS year,
         EXTRACT(MONTH FROM d.doc_date)::int AS month,
         dl.item_code,
         MAX(dl.item_name)                    AS item_name,
         SUM(dl.quantity::numeric)            AS quantity,
         SUM(dl.line_total::numeric)          AS revenue,
         COUNT(DISTINCT dl.doc_number)::int   AS invoice_count,
         COUNT(*)                             AS lines
  FROM dashboard.document_lines dl
  JOIN dashboard.documents d
    ON d.year = dl.year AND d.format = dl.format AND d.doc_number = dl.doc_number
  WHERE d.format = '11' AND d.doc_date IS NOT NULL AND length(dl.item_code) > 1
  GROUP BY 1,2,3
), months AS (
  SELECT year, month, SUM(lines) AS lines, SUM(revenue) AS revenue
  FROM derived GROUP BY 1,2
), existing AS (
  SELECT year, month, SUM(revenue::numeric) AS revenue, COUNT(*) AS rows
  FROM dashboard.monthly_sales GROUP BY 1,2
), keep AS (
  -- A month is imported when it is MISSING, or when what is there is a stub. July 2025 sits
  -- in monthly_sales as 30 rows / 22,142 against 8,136 invoice lines / 2,505,168 in the very
  -- same database — a partial write from an interrupted sync, and "the month exists" is
  -- exactly the test that would have kept it. Anything holding at least half the derived
  -- revenue is left alone: 2026-04 and 2026-05 have real figures from the live sync while
  -- their document lines carry no line_total, and those must never be overwritten.
  SELECT m.year, m.month FROM months m
  LEFT JOIN existing e ON e.year = m.year AND e.month = m.month
  WHERE m.lines >= ${MIN_LINES} AND m.revenue > 0
    AND (e.year IS NULL OR e.revenue < m.revenue * 0.5)
)
SELECT d.* FROM derived d JOIN keep k ON k.year = d.year AND k.month = d.month`
const preview = await c.query(`SELECT year, month, COUNT(*) rows, ROUND(SUM(revenue)) revenue FROM (${sql}) x GROUP BY 1,2 ORDER BY 1,2`)
console.log('months to import:', preview.rowCount)
for (const r of preview.rows) console.log(` ${r.year}-${String(r.month).padStart(2,'0')} rows=${r.rows} revenue=${r.revenue}`)
console.log('total rows:', preview.rows.reduce((s,r)=>s+Number(r.rows),0))
if (!DRY) {
  const res = await c.query(`
    INSERT INTO dashboard.monthly_sales (year, month, item_code, item_name, quantity, revenue, invoice_count, season)
    SELECT year, month, item_code, item_name, quantity, revenue, invoice_count,
           CASE WHEN month IN (5,6,7,8,9,10) THEN 'summer' ELSE 'winter' END
    FROM (${sql}) x
    ON CONFLICT (year, month, item_code) DO UPDATE SET
      item_name = excluded.item_name, quantity = excluded.quantity,
      revenue = excluded.revenue, invoice_count = excluded.invoice_count,
      season = excluded.season`)
  console.log('inserted:', res.rowCount)
}
await c.end()
