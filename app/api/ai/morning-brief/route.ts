import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getGeminiFlash, SYSTEM_PROMPT_HE } from '@/lib/gemini'
import { getCached, setCache } from '@/lib/redis-client'
import { getDashboardData } from '@/lib/services/analytics-service'
import { client } from '@/lib/finansit-client'
import { query as dbQuery } from '@/lib/db'
import { readQueryAsync } from '@/lib/neon-read'

export const runtime = 'nodejs'
export const maxDuration = 60

interface MorningBriefCache {
  summary: string
  bullets: string[]
  generatedAt: string
}

const CACHE_KEY = 'ai:morning-brief'
const CACHE_TTL = 4 * 60 * 60 // 4 hours

// ── Data aggregation helpers ──

async function getSalesKpis() {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]
  const yearAgo = new Date(now.getTime() - 365 * 86400000)
  const yearAgoMonthStart = `${yearAgo.getFullYear()}-${String(yearAgo.getMonth() + 1).padStart(2, '0')}-01`
  const yearAgoToday = yearAgo.toISOString().split('T')[0]

  // Try SQLite first, then PostgreSQL
  let todaySales = { total: 0, count: 0 }
  let weekSales = { total: 0, count: 0 }
  let monthSales = { total: 0, count: 0 }
  let yearAgoMonthSales = { total: 0, count: 0 }

  try {
    const tRes = await readQueryAsync(
      `SELECT COALESCE(SUM(revenue), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM daily_sales WHERE date = ?`,
      [today],
    )
    if (tRes.rows.length > 0) todaySales = { total: parseFloat(tRes.rows[0].total), count: parseInt(tRes.rows[0].count) || 0 }

    const wRes = await readQueryAsync(
      `SELECT COALESCE(SUM(revenue), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM daily_sales WHERE date >= ? AND date <= ?`,
      [weekAgo, today],
    )
    if (wRes.rows.length > 0) weekSales = { total: parseFloat(wRes.rows[0].total), count: parseInt(wRes.rows[0].count) || 0 }

    const mRes = await readQueryAsync(
      `SELECT COALESCE(SUM(revenue), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM daily_sales WHERE date >= ? AND date <= ?`,
      [monthStart, today],
    )
    if (mRes.rows.length > 0) monthSales = { total: parseFloat(mRes.rows[0].total), count: parseInt(mRes.rows[0].count) || 0 }

    const yRes = await readQueryAsync(
      `SELECT COALESCE(SUM(revenue), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM daily_sales WHERE date >= ? AND date <= ?`,
      [yearAgoMonthStart, yearAgoToday],
    )
    if (yRes.rows.length > 0) yearAgoMonthSales = { total: parseFloat(yRes.rows[0].total), count: parseInt(yRes.rows[0].count) || 0 }
  } catch {
    // Fallback to PostgreSQL
    try {
      const tRes = await dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM dashboard.daily_sales WHERE date = $1`, [today])
      if (tRes.rows.length > 0) todaySales = { total: parseFloat(tRes.rows[0].total), count: parseInt(tRes.rows[0].count) || 0 }

      const wRes = await dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM dashboard.daily_sales WHERE date >= $1 AND date <= $2`, [weekAgo, today])
      if (wRes.rows.length > 0) weekSales = { total: parseFloat(wRes.rows[0].total), count: parseInt(wRes.rows[0].count) || 0 }

      const mRes = await dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM dashboard.daily_sales WHERE date >= $1 AND date <= $2`, [monthStart, today])
      if (mRes.rows.length > 0) monthSales = { total: parseFloat(mRes.rows[0].total), count: parseInt(mRes.rows[0].count) || 0 }

      const yRes = await dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM dashboard.daily_sales WHERE date >= $1 AND date <= $2`, [yearAgoMonthStart, yearAgoToday])
      if (yRes.rows.length > 0) yearAgoMonthSales = { total: parseFloat(yRes.rows[0].total), count: parseInt(yRes.rows[0].count) || 0 }
    } catch (e) {
      console.warn('[morning-brief] DB queries failed:', e)
    }
  }

  const yoyChange = yearAgoMonthSales.total > 0
    ? Math.round(((monthSales.total - yearAgoMonthSales.total) / yearAgoMonthSales.total) * 100)
    : null

  return { todaySales, weekSales, monthSales, yearAgoMonthSales, yoyChange }
}

async function getTopOverdueCustomers() {
  try {
    // Fetch a small set of customers and check aging
    const data = await client.customers.list({ limit: 100, sort: 'code', direction: 'asc' })
    const customers: any[] = data.customers || []

    const overdue: { name: string; code: string; balance: number }[] = []
    // Check first batch for balance
    for (const c of customers.slice(0, 50)) {
      if (c.balance && c.balance > 1000) {
        overdue.push({ name: c.name || c.code, code: c.code, balance: c.balance })
      }
    }

    return overdue
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
  } catch (e) {
    console.warn('[morning-brief] overdue customers failed:', e)
    return []
  }
}

async function getGapHighlights() {
  try {
    const data = await client.analytics.gap({
      doc_format: '31',
      require_zero_stock: true,
      require_zero_incoming: true,
      limit: 10,
    }) as any

    const items: any[] = (data?.items || []).slice(0, 5).map((item: any) => ({
      code: item.item_code,
      name: item.item_name || item.item_code,
      times_quoted: item.times_quoted ?? 0,
      qty_quoted: item.total_qty_quoted ?? 0,
    }))

    return { count: data?.gap_count ?? 0, items }
  } catch (e) {
    console.warn('[morning-brief] gap analysis failed:', e)
    return { count: 0, items: [] }
  }
}

async function getStockAlerts() {
  try {
    const data = await client.stock.getAll()
    const items: any[] = data.items || []

    // Items with sales activity but critically low stock
    const alerts = items
      .filter((i: any) => i.stock_qty > 0 && i.stock_qty <= 2 && (i.sold_this_year > 0 || i.sold_last_year > 0))
      .sort((a: any, b: any) => (b.sold_this_year || 0) - (a.sold_this_year || 0))
      .slice(0, 5)
      .map((i: any) => ({ code: i.code, name: i.name, stock: i.stock_qty, soldThisYear: i.sold_this_year || 0 }))

    return alerts
  } catch (e) {
    console.warn('[morning-brief] stock alerts failed:', e)
    return []
  }
}

// ── Route handler ──

export async function GET() {
  try {
    await initializeSecrets()

    // Check cache first
    const cached = await getCached<MorningBriefCache>(CACHE_KEY)
    if (cached) {
      return NextResponse.json({ ...cached, cached: true })
    }

    // Aggregate data in parallel
    const [salesKpis, dashboardData, overdueCustomers, gapData, stockAlerts] = await Promise.all([
      getSalesKpis(),
      getDashboardData().catch(() => null),
      getTopOverdueCustomers(),
      getGapHighlights(),
      getStockAlerts(),
    ])

    // Build prompt
    const prompt = `אתה מכין תקציר בוקר יומי עבור מנהל של מפיץ חלפי רכב (Jan Parts).
הנה הנתונים העדכניים:

**מכירות:**
- היום: ₪${Math.round(salesKpis.todaySales.total).toLocaleString()} (${salesKpis.todaySales.count} עסקאות)
- השבוע: ₪${Math.round(salesKpis.weekSales.total).toLocaleString()} (${salesKpis.weekSales.count} עסקאות)
- החודש: ₪${Math.round(salesKpis.monthSales.total).toLocaleString()} (${salesKpis.monthSales.count} עסקאות)
${salesKpis.yoyChange !== null ? `- שינוי שנתי (YoY): ${salesKpis.yoyChange > 0 ? '+' : ''}${salesKpis.yoyChange}%` : ''}

**סטטוס תפעולי:**
- הצעות מחיר פתוחות: ${dashboardData?.open_quotes?.count ?? 'לא זמין'}${dashboardData?.open_quotes?.total ? ` (₪${Math.round(dashboardData.open_quotes.total).toLocaleString()})` : ''}
- תעודות משלוח פתוחות: ${dashboardData?.open_delivery_notes?.count ?? 'לא זמין'}

**לקוחות עם יתרת חוב גבוהה:**
${overdueCustomers.length > 0
  ? overdueCustomers.map(c => `- ${c.name}: ₪${Math.round(c.balance).toLocaleString()}`).join('\n')
  : '- אין נתונים זמינים'}

**פערי מלאי (פריטים שצוטטו אך לא במלאי):**
- סה"כ פריטים חסרים: ${gapData.count}
${gapData.items.length > 0
  ? gapData.items.map(i => `- ${i.name} (${i.code}): צוטט ${i.times_quoted} פעמים, כמות ${i.qty_quoted}`).join('\n')
  : '- אין פערים קריטיים'}

**התראות מלאי (פריטים עם מלאי קריטי ומכירות פעילות):**
${stockAlerts.length > 0
  ? stockAlerts.map(a => `- ${a.name} (${a.code}): ${a.stock} יחידות במלאי, נמכרו ${a.soldThisYear} השנה`).join('\n')
  : '- אין התראות קריטיות'}

כתוב תקציר בוקר קצר ומעשי בעברית — 3-5 נקודות (bullets).
כל נקודה צריכה להיות משפט אחד תמציתי.
התמקד בדברים חשובים ומעשיים: מגמות, בעיות שדורשות טיפול, הזדמנויות.
אל תחזור על כל המספרים — רק הדגש את מה שחשוב באמת.
החזר את התשובה כ-JSON בפורמט הבא בלבד (ללא markdown):
{"summary": "משפט סיכום כללי קצר", "bullets": ["נקודה 1", "נקודה 2", "נקודה 3"]}`

    let parsed: { summary: string; bullets: string[] }
    try {
      const result = await generateText({
        model: getGeminiFlash(),
        system: SYSTEM_PROMPT_HE,
        prompt,
        // Hebrew tokenizes densely; 500 truncated the JSON mid-string, which then
        // leaked raw `{"summary": ...` into the UI. Give it room to close the JSON.
        maxOutputTokens: 1000,
      })

      // Parse the response
      try {
        // Try to extract JSON from the response (Gemini might wrap it in markdown)
        const text = result.text.trim()
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('No JSON found')
        const raw = JSON.parse(jsonMatch[0])
        parsed = {
          summary: typeof raw.summary === 'string' ? raw.summary : 'תקציר בוקר',
          bullets: Array.isArray(raw.bullets) ? raw.bullets.map(String) : [],
        }
      } catch {
        // The model returned truncated or malformed JSON. If it was *trying* to be
        // JSON (starts with '{' or a markdown fence) but won't parse, never echo the
        // raw/partial object into the UI — bail to the deterministic brief below.
        const text = result.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
        if (text.startsWith('{') || text.startsWith('[')) {
          throw new Error('model returned unparseable JSON')
        }
        // Otherwise it's plain text / markdown bullets — use those as-is.
        const lines = text.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
        parsed = { summary: lines[0] || 'תקציר בוקר', bullets: lines.slice(1).length > 0 ? lines.slice(1) : lines }
      }
    } catch (aiErr) {
      // AI unavailable (e.g. GEMINI_API_KEY not set, or generation failed) —
      // degrade gracefully to a deterministic, data-driven brief (HTTP 200)
      // instead of 500-ing the whole overview page.
      console.warn('[morning-brief] AI unavailable or unparseable, using templated brief:', aiErr instanceof Error ? aiErr.message : aiErr)
      const fmt = (n: number) => `₪${Math.round(n).toLocaleString()}`
      const bullets: string[] = []
      bullets.push(`מכירות החודש: ${fmt(salesKpis.monthSales.total)} (${salesKpis.monthSales.count} עסקאות)${salesKpis.yoyChange !== null ? `, שינוי שנתי ${salesKpis.yoyChange > 0 ? '+' : ''}${salesKpis.yoyChange}%` : ''}`)
      bullets.push(`מכירות היום: ${fmt(salesKpis.todaySales.total)} · השבוע: ${fmt(salesKpis.weekSales.total)}`)
      if (dashboardData?.open_quotes?.count) bullets.push(`הצעות מחיר פתוחות: ${dashboardData.open_quotes.count}${dashboardData.open_quotes.total ? ` (${fmt(dashboardData.open_quotes.total)})` : ''}`)
      if (gapData.count) bullets.push(`פערי מלאי: ${gapData.count} פריטים שצוטטו אך אינם במלאי`)
      if (stockAlerts.length) bullets.push(`${stockAlerts.length} פריטים עם מלאי קריטי ומכירות פעילות — לבדוק חידוש מלאי`)
      if (overdueCustomers.length) bullets.push(`${overdueCustomers.length} לקוחות עם יתרת חוב גבוהה, מובילם: ${overdueCustomers[0].name} (${fmt(overdueCustomers[0].balance)})`)
      parsed = { summary: 'תקציר בוקר (ללא AI — מבוסס נתונים בלבד)', bullets }
    }

    const briefData: MorningBriefCache = {
      summary: parsed.summary,
      bullets: parsed.bullets,
      generatedAt: new Date().toISOString(),
    }

    // Cache for 4 hours
    await setCache(CACHE_KEY, briefData, CACHE_TTL)

    return NextResponse.json({ ...briefData, cached: false })
  } catch (error) {
    console.error('[morning-brief] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate morning brief' },
      { status: 500 },
    )
  }
}
