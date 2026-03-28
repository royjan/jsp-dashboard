#!/usr/bin/env node
/**
 * Generate an HTML report for dead stock items filtered by description.
 * Usage: node scripts/generate-dead-stock-report.js "בטנ" [output.html]
 */

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const searchTerm = process.argv[2]
if (!searchTerm) {
  console.error('Usage: node scripts/generate-dead-stock-report.js <search_term> [output.html]')
  console.error('Example: node scripts/generate-dead-stock-report.js "בטנ"')
  process.exit(1)
}

const outputFile = process.argv[3] || `dead-stock-${searchTerm.replace(/[^a-zA-Zא-ת0-9]/g, '_')}.html`
const dbPath = path.join(__dirname, '..', 'data', 'dashboard-history.db')
const db = new Database(dbPath, { readonly: true })

const patterns = searchTerm.split(',').map(s => s.trim()).filter(Boolean)
const whereClause = patterns.map(() => `item_name LIKE ?`).join(' OR ')
const params = patterns.map(p => `%${p}%`)

const items = db.prepare(`
  SELECT
    item_code,
    item_name,
    CAST(qty AS INT) as qty,
    retail_price,
    ROUND(qty * retail_price) as capital_tied,
    CAST(sold_this_year AS INT) as sold_this_year,
    CAST(sold_last_year AS INT) as sold_last_year,
    CAST(sold_2y_ago AS INT) as sold_2y_ago,
    CAST(sold_3y_ago AS INT) as sold_3y_ago,
    ROUND(
      MIN(LOG10(MAX(qty * retail_price, 1)) * 11.5, 50)
      + CASE
          WHEN sold_last_year = 0 AND sold_2y_ago = 0 AND sold_3y_ago = 0 THEN 30
          WHEN sold_last_year = 0 AND sold_2y_ago = 0 THEN 15
          WHEN sold_last_year = 0 THEN 5
          ELSE 0
        END
      + MIN(qty / 3.0, 10)
      - MIN((sold_last_year + sold_2y_ago + sold_3y_ago) * 3, 20)
    , 1) as scrap_score
  FROM item_snapshot
  WHERE qty > 0
    AND (${whereClause})
    AND sold_this_year = 0
  ORDER BY scrap_score DESC
`).all(...params)

const totalItems = items.length
const totalUnits = items.reduce((s, i) => s + i.qty, 0)
const totalCapital = items.reduce((s, i) => s + i.capital_tied, 0)
const neverSold = items.filter(i => i.sold_last_year === 0 && i.sold_2y_ago === 0 && i.sold_3y_ago === 0)
const neverSoldCapital = neverSold.reduce((s, i) => s + i.capital_tied, 0)
const soldBefore = items.filter(i => i.sold_last_year > 0 || i.sold_2y_ago > 0 || i.sold_3y_ago > 0)
const soldBeforeCapital = soldBefore.reduce((s, i) => s + i.capital_tied, 0)

function formatILS(n) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(n)
}

function getSalesHistory(item) {
  const total = item.sold_last_year + item.sold_2y_ago + item.sold_3y_ago
  if (total === 0) return '<span class="never">אף פעם לא נמכר</span>'
  const parts = []
  if (item.sold_last_year > 0) parts.push(`שנה שעברה: ${item.sold_last_year}`)
  if (item.sold_2y_ago > 0) parts.push(`לפני שנתיים: ${item.sold_2y_ago}`)
  if (item.sold_3y_ago > 0) parts.push(`לפני 3+ שנים: ${item.sold_3y_ago}`)
  return `<span class="sold-before">סה"כ ${total}</span><br><small>${parts.join(' | ')}</small>`
}

function getScoreColor(score) {
  if (score >= 75) return '#ef4444'
  if (score >= 65) return '#f97316'
  if (score >= 55) return '#eab308'
  return '#94a3b8'
}

const date = new Date().toLocaleDateString('he-IL')

const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>דוח מלאי מת - ${searchTerm} | Jan Parts</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
  .container { max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; color: #f8fafc; }
  .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 24px; }

  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; }
  .summary-card .label { font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px; }
  .summary-card .value { font-size: 1.5rem; font-weight: 700; }
  .summary-card .sub { font-size: 0.7rem; color: #64748b; margin-top: 2px; }
  .text-red { color: #f87171; }
  .text-amber { color: #fbbf24; }
  .text-blue { color: #60a5fa; }

  .score-legend { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .score-legend h3 { font-size: 0.85rem; margin-bottom: 8px; color: #94a3b8; }
  .score-legend .items { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.8rem; }
  .score-legend .items span { display: flex; align-items: center; gap: 6px; }
  .score-legend .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }

  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  thead { position: sticky; top: 0; background: #1e293b; z-index: 10; }
  th { padding: 10px 8px; text-align: right; font-weight: 600; color: #94a3b8; border-bottom: 2px solid #334155; white-space: nowrap; cursor: pointer; user-select: none; }
  th:hover { color: #e2e8f0; }
  th.sorted-asc::after { content: ' ▲'; color: #60a5fa; }
  th.sorted-desc::after { content: ' ▼'; color: #60a5fa; }
  td { padding: 8px; border-bottom: 1px solid #1e293b; vertical-align: top; }
  tr:hover { background: #1e293b; }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-variant-numeric: tabular-nums; }
  .text-end { text-align: left; }
  .code { font-size: 0.7rem; color: #64748b; }
  .never { color: #f87171; font-weight: 600; }
  .sold-before { color: #fbbf24; }
  small { color: #64748b; }

  .score-bar { display: flex; align-items: center; gap: 6px; }
  .score-bar-bg { width: 60px; height: 8px; background: #334155; border-radius: 4px; overflow: hidden; position: relative; }
  .score-bar-fill { height: 100%; border-radius: 4px; }
  .score-num { font-weight: 700; font-size: 0.85rem; min-width: 32px; }

  .table-wrap { background: #0f172a; border: 1px solid #334155; border-radius: 12px; overflow: hidden; }
  .table-scroll { max-height: 75vh; overflow-y: auto; }
  tfoot td { font-weight: 700; border-top: 2px solid #334155; background: #1e293b; }

  .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
  .filter-bar input { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 8px 12px; color: #e2e8f0; font-size: 0.85rem; flex: 1; min-width: 200px; }
  .filter-bar input::placeholder { color: #64748b; }

  @media print {
    body { background: white; color: black; padding: 10px; font-size: 9pt; }
    .summary-card { border-color: #ccc; background: #f9f9f9; }
    .summary-card .value, .summary-card .label, .summary-card .sub, small { color: #333; }
    .table-wrap { border-color: #ccc; }
    thead { background: #f0f0f0; }
    th { color: #333; border-color: #ccc; }
    td { border-color: #eee; }
    tr:hover { background: transparent; }
    .text-red, .never { color: #dc2626; }
    .text-amber, .sold-before { color: #d97706; }
    .filter-bar { display: none; }
    .table-scroll { max-height: none; overflow: visible; }
    .score-legend { background: #f9f9f9; border-color: #ccc; }
    .score-bar-bg { background: #ddd; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>דוח מלאי מת — ${searchTerm}</h1>
  <p class="subtitle">Jan Parts | ${date} | ${totalItems} פריטים | ממוין לפי ציון גריטה (גבוה = להעיף ראשון)</p>

  <div class="summary">
    <div class="summary-card">
      <div class="label">סה"כ פריטים מתים</div>
      <div class="value text-red">${totalItems}</div>
      <div class="sub">${totalUnits} יחידות</div>
    </div>
    <div class="summary-card">
      <div class="label">הון כלוא</div>
      <div class="value text-red">${formatILS(totalCapital)}</div>
    </div>
    <div class="summary-card">
      <div class="label">אף פעם לא נמכרו</div>
      <div class="value text-amber">${neverSold.length} פריטים</div>
      <div class="sub">${formatILS(neverSoldCapital)} (${totalCapital > 0 ? Math.round(neverSoldCapital / totalCapital * 100) : 0}%)</div>
    </div>
    <div class="summary-card">
      <div class="label">נמכרו בעבר</div>
      <div class="value text-blue">${soldBefore.length} פריטים</div>
      <div class="sub">${formatILS(soldBeforeCapital)}</div>
    </div>
  </div>

  <div class="score-legend">
    <h3>ציון גריטה — ככל שגבוה יותר, כדאי יותר להיפטר</h3>
    <div class="items">
      <span><span class="dot" style="background:#ef4444"></span> 75+ קריטי — להעיף מיד</span>
      <span><span class="dot" style="background:#f97316"></span> 65-74 גבוה — חיסול/גריטה</span>
      <span><span class="dot" style="background:#eab308"></span> 55-64 בינוני — מבצע/החזרה</span>
      <span><span class="dot" style="background:#94a3b8"></span> &lt;55 נמוך</span>
    </div>
  </div>

  <div class="filter-bar">
    <input type="text" id="search" placeholder="סנן לפי שם או קוד..." oninput="filterTable()">
  </div>

  <div class="table-wrap">
    <div class="table-scroll">
      <table id="mainTable">
        <thead>
          <tr>
            <th data-col="0" data-type="num">#</th>
            <th data-col="1" data-type="str">קוד</th>
            <th data-col="2" data-type="str">תיאור</th>
            <th data-col="3" data-type="num">כמות</th>
            <th data-col="4" data-type="num">מחיר ₪</th>
            <th data-col="5" data-type="num">הון כלוא ₪</th>
            <th data-col="6" data-type="str">היסטוריית מכירות</th>
            <th data-col="7" data-type="num" class="sorted-desc">ציון גריטה</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, i) => {
            const color = getScoreColor(item.scrap_score)
            const pct = Math.min(item.scrap_score, 100)
            return `<tr>
              <td class="mono">${i + 1}</td>
              <td class="mono code">${item.item_code}</td>
              <td>${item.item_name}</td>
              <td class="mono text-end" data-val="${item.qty}">${item.qty}</td>
              <td class="mono text-end" data-val="${item.retail_price}">${formatILS(item.retail_price)}</td>
              <td class="mono text-end text-red" style="font-weight:600" data-val="${item.capital_tied}">${formatILS(item.capital_tied)}</td>
              <td>${getSalesHistory(item)}</td>
              <td data-val="${item.scrap_score}">
                <div class="score-bar">
                  <span class="score-num" style="color:${color}">${item.scrap_score}</span>
                  <div class="score-bar-bg"><div class="score-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                </div>
              </td>
            </tr>`
          }).join('\n          ')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">סה"כ ${totalItems} פריטים</td>
            <td class="mono text-end">${totalUnits}</td>
            <td></td>
            <td class="mono text-end text-red">${formatILS(totalCapital)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</div>

<script>
function filterTable() {
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('#mainTable tbody tr').forEach(row => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

document.querySelectorAll('#mainTable thead th').forEach(th => {
  th.addEventListener('click', () => {
    const col = parseInt(th.dataset.col);
    const type = th.dataset.type;
    const tbody = document.querySelector('#mainTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Toggle direction
    const wasDesc = th.classList.contains('sorted-desc');
    const wasAsc = th.classList.contains('sorted-asc');
    document.querySelectorAll('#mainTable th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));

    const asc = wasDesc; // if was desc, flip to asc
    th.classList.add(asc ? 'sorted-asc' : 'sorted-desc');

    rows.sort((a, b) => {
      let aVal, bVal;
      const aCell = a.cells[col], bCell = b.cells[col];
      if (type === 'num') {
        aVal = parseFloat(aCell.dataset.val || aCell.textContent.replace(/[^0-9.-]/g, '')) || 0;
        bVal = parseFloat(bCell.dataset.val || bCell.textContent.replace(/[^0-9.-]/g, '')) || 0;
      } else {
        aVal = aCell.textContent.trim();
        bVal = bCell.textContent.trim();
      }
      if (type === 'num') return asc ? aVal - bVal : bVal - aVal;
      return asc ? aVal.localeCompare(bVal, 'he') : bVal.localeCompare(aVal, 'he');
    });

    // Re-number rows
    rows.forEach((r, i) => { r.cells[0].textContent = i + 1; tbody.appendChild(r); });
  });
});
</script>
</body>
</html>`

fs.writeFileSync(outputFile, html, 'utf8')
console.log(`Report generated: ${outputFile} (${totalItems} items, ${formatILS(totalCapital)} capital tied)`)
db.close()
