#!/usr/bin/env node

/**
 * One-time migration: fix reversed Latin/digit sequences in Hebrew item names.
 *
 * The Finansit system stores item names with reversed Latin character and digit
 * sequences due to RTL input handling. This script fixes existing data in both
 * SQLite (dashboard-history.db) and PostgreSQL (dashboard schema).
 *
 * Usage: node scripts/fix-rtl-names.js [--pg] [--dry-run] [--html]
 *   --pg       Also fix PostgreSQL (requires AWS secrets access)
 *   --dry-run  Show what would change without writing
 *   --html     Generate an RTL HTML report of all changes
 */

const path = require('path')
const fs = require('fs')

const DB_PATH = path.join(__dirname, '..', 'data', 'dashboard-history.db')
const HTML_PATH = path.join(__dirname, '..', 'rtl-fix-report.html')

function fixRtlItemName(name) {
  if (!name) return name
  if (!/[\u0590-\u05FF]/.test(name)) return name
  return name.replace(/[A-Za-z0-9]+/g, (match) => match.split('').reverse().join(''))
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function generateHtml(allChanges) {
  const tableRows = allChanges.map((c, i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td class="idx">${i + 1}</td>
        <td class="table-name">${escapeHtml(c.table)}</td>
        <td class="name-cell before">${escapeHtml(c.original)}</td>
        <td class="arrow">&#x2192;</td>
        <td class="name-cell after">${escapeHtml(c.corrected)}</td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>RTL Fix Report - ${allChanges.length} changes</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #f8fafc; }
  .subtitle { color: #94a3b8; margin-bottom: 20px; font-size: 0.9rem; }
  .summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 12px 20px; }
  .stat .label { font-size: 0.8rem; color: #94a3b8; }
  .stat .value { font-size: 1.4rem; font-weight: 700; color: #38bdf8; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  thead { position: sticky; top: 0; }
  th { background: #1e293b; color: #94a3b8; padding: 10px 12px; text-align: right; border-bottom: 2px solid #334155; font-weight: 600; }
  td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
  tr.even { background: #0f172a; }
  tr.odd { background: #131c2e; }
  tr:hover { background: #1e293b; }
  .idx { color: #475569; text-align: center; width: 50px; font-size: 0.75rem; }
  .table-name { color: #64748b; font-family: monospace; font-size: 0.75rem; width: 120px; }
  .name-cell { font-size: 0.95rem; direction: rtl; unicode-bidi: plaintext; }
  .before { color: #f87171; }
  .after { color: #4ade80; }
  .arrow { text-align: center; width: 30px; color: #475569; direction: ltr; }
  .container { max-width: 1100px; margin: 0 auto; }
  .filter-bar { margin-bottom: 16px; display: flex; gap: 12px; align-items: center; }
  .filter-bar input { background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #e2e8f0; font-size: 0.85rem; width: 300px; direction: rtl; }
  .filter-bar input::placeholder { color: #64748b; }
  .count { color: #64748b; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="container">
  <h1>RTL Fix Report</h1>
  <p class="subtitle">שמות פריטים עם רצפי לטינית/ספרות הפוכים - לפני ואחרי תיקון</p>
  <div class="summary">
    <div class="stat"><div class="label">שינויים</div><div class="value">${allChanges.length.toLocaleString()}</div></div>
    <div class="stat"><div class="label">item_snapshot</div><div class="value">${allChanges.filter(c => c.table === 'item_snapshot').length.toLocaleString()}</div></div>
    <div class="stat"><div class="label">monthly_sales</div><div class="value">${allChanges.filter(c => c.table === 'monthly_sales').length.toLocaleString()}</div></div>
  </div>
  <div class="filter-bar">
    <input type="text" id="search" placeholder="חיפוש..." oninput="filterRows()">
    <span class="count" id="count"></span>
  </div>
  <table>
    <thead>
      <tr><th style="text-align:center">#</th><th>טבלה</th><th>לפני</th><th></th><th>אחרי</th></tr>
    </thead>
    <tbody id="tbody">
      ${tableRows}
    </tbody>
  </table>
</div>
<script>
function filterRows() {
  const q = document.getElementById('search').value.toLowerCase();
  const rows = document.querySelectorAll('#tbody tr');
  let shown = 0;
  rows.forEach(r => {
    const match = !q || r.textContent.toLowerCase().includes(q);
    r.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  document.getElementById('count').textContent = q ? shown + ' / ' + rows.length : '';
}
</script>
</body>
</html>`
}

async function fixSqlite(dryRun, collectHtml) {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`SQLite file not found at ${DB_PATH}, skipping.`)
    return []
  }

  const Database = require('better-sqlite3')
  const db = new Database(DB_PATH)

  let totalFixed = 0
  const allChanges = []

  for (const table of ['item_snapshot', 'monthly_sales']) {
    const nameCol = 'item_name'
    const rows = db.prepare(`SELECT rowid, ${nameCol} FROM ${table} WHERE ${nameCol} IS NOT NULL`).all()

    let fixed = 0
    const update = db.prepare(`UPDATE ${table} SET ${nameCol} = ? WHERE rowid = ?`)

    const runBatch = db.transaction((changes) => {
      for (const { rowid, newName } of changes) {
        update.run(newName, rowid)
      }
    })

    const changes = []
    for (const row of rows) {
      const original = row[nameCol]
      const corrected = fixRtlItemName(original)
      if (corrected !== original) {
        fixed++
        if (!collectHtml && dryRun && fixed <= 10) {
          console.log(`  [${table}] "${original}" → "${corrected}"`)
        }
        if (collectHtml) {
          allChanges.push({ table, original, corrected })
        }
        changes.push({ rowid: row.rowid, newName: corrected })
      }
    }

    if (!dryRun && changes.length > 0) {
      runBatch(changes)
    }

    console.log(`[SQLite/${table}] ${fixed} names fixed out of ${rows.length} rows`)
    totalFixed += fixed
  }

  db.close()
  console.log(`[SQLite] Total: ${totalFixed} names fixed${dryRun ? ' (dry run)' : ''}`)
  return allChanges
}

async function fixPostgres(dryRun) {
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')
  const { Pool } = require('pg')

  const client = new SecretsManagerClient({ region: 'eu-central-1' })
  const resp = await client.send(new GetSecretValueCommand({ SecretId: 'config' }))
  const secrets = JSON.parse(resp.SecretString)
  const pool = new Pool({ connectionString: secrets.DATABASE_URL, max: 3 })

  let totalFixed = 0

  const tables = [
    { table: 'dashboard.monthly_sales', nameCol: 'item_name', keyCol: 'item_code, year, month' },
    { table: 'dashboard.item_snapshots', nameCol: 'item_name', keyCol: 'item_code, snapshot_date' },
    { table: 'dashboard.item_snapshot', nameCol: 'item_name', keyCol: 'item_code' },
  ]

  for (const { table, nameCol, keyCol } of tables) {
    try {
      const result = await pool.query(`SELECT ctid, ${nameCol} FROM ${table} WHERE ${nameCol} IS NOT NULL`)
      let fixed = 0

      for (const row of result.rows) {
        const original = row[nameCol]
        const corrected = fixRtlItemName(original)
        if (corrected !== original) {
          fixed++
          if (dryRun && fixed <= 5) {
            console.log(`  [${table}] "${original}" → "${corrected}"`)
          }
          if (!dryRun) {
            await pool.query(`UPDATE ${table} SET ${nameCol} = $1 WHERE ctid = $2`, [corrected, row.ctid])
          }
        }
      }

      console.log(`[PG/${table}] ${fixed} names fixed out of ${result.rows.length} rows${dryRun ? ' (dry run)' : ''}`)
      totalFixed += fixed
    } catch (err) {
      if (err.message.includes('does not exist')) {
        console.log(`[PG/${table}] Table does not exist, skipping.`)
      } else {
        throw err
      }
    }
  }

  await pool.end()
  console.log(`[PostgreSQL] Total: ${totalFixed} names fixed${dryRun ? ' (dry run)' : ''}`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const fixPg = process.argv.includes('--pg')
  const html = process.argv.includes('--html')

  console.log(`=== Fix RTL Item Names ===${dryRun ? ' (DRY RUN)' : ''}${html ? ' (HTML report)' : ''}\n`)

  const allChanges = await fixSqlite(dryRun || html, html)

  if (html && allChanges.length > 0) {
    fs.writeFileSync(HTML_PATH, generateHtml(allChanges))
    console.log(`\nHTML report: ${HTML_PATH}`)
  }

  if (fixPg) {
    console.log('')
    await fixPostgres(dryRun)
  } else {
    console.log('\nSkipping PostgreSQL (use --pg to include)')
  }

  console.log('\nDone!')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
