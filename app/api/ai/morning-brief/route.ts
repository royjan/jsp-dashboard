import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { generateTextWithFallback, SYSTEM_PROMPT_HE } from '@/lib/gemini'
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
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0]
  const lastWeekSameDay = new Date(now.getTime() - 8 * 86400000).toISOString().split('T')[0]
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

  // A DAILY report leads with the day that just closed — yesterday's revenue plus
  // the same weekday last week as its natural yardstick (weekday-sensitive trade).
  let yesterdaySales = { total: 0, count: 0 }
  let lastWeekSameDaySales = { total: 0, count: 0 }
  try {
    const [yd, lw] = await Promise.all([
      dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM dashboard.daily_sales WHERE date = $1`, [yesterday]),
      dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total, COALESCE(SUM(invoice_count), 0) as count FROM dashboard.daily_sales WHERE date = $1`, [lastWeekSameDay]),
    ])
    yesterdaySales = { total: parseFloat(yd.rows[0]?.total || 0), count: parseInt(yd.rows[0]?.count) || 0 }
    lastWeekSameDaySales = { total: parseFloat(lw.rows[0]?.total || 0), count: parseInt(lw.rows[0]?.count) || 0 }
  } catch (e) {
    console.warn('[morning-brief] yesterday queries failed:', e)
  }

  // TRUE annual comparison (YTD vs same window last year) + data freshness. The old
  // prompt labeled the month-vs-last-July delta "שינוי שנתי" — the 24.07 brief then
  // reported a "34% annual collapse" while annual sales were actually flat (+0.3%).
  let ytdYoy: number | null = null
  let ytdTotal: number | null = null
  let ytdPrevTotal: number | null = null
  let dataThrough: string | null = null
  try {
    const ytdStart = `${now.getFullYear()}-01-01`
    const ytdAgoStart = `${yearAgo.getFullYear()}-01-01`
    const [cur, prev, fresh] = await Promise.all([
      dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total FROM dashboard.daily_sales WHERE date >= $1 AND date <= $2`, [ytdStart, today]),
      dbQuery(`SELECT COALESCE(SUM(revenue::numeric), 0) as total FROM dashboard.daily_sales WHERE date >= $1 AND date <= $2`, [ytdAgoStart, yearAgoToday]),
      dbQuery(`SELECT MAX(date) as d FROM dashboard.daily_sales`),
    ])
    const c = parseFloat(cur.rows[0]?.total || 0)
    const p = parseFloat(prev.rows[0]?.total || 0)
    if (p > 0) ytdYoy = Math.round(((c - p) / p) * 100)
    ytdTotal = c
    ytdPrevTotal = p
    const d = fresh.rows[0]?.d
    if (d) dataThrough = new Date(d).toISOString().split('T')[0]
  } catch (e) {
    console.warn('[morning-brief] YTD queries failed:', e)
  }

  return { todaySales, yesterdaySales, lastWeekSameDaySales, weekSales, monthSales, yearAgoMonthSales, yoyChange, ytdYoy, ytdTotal, ytdPrevTotal, dataThrough }
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

    return { count: data?.gap_count ?? 0, items, failed: false }
  } catch (e) {
    console.warn('[morning-brief] gap analysis failed:', e)
    // failed ≠ zero gaps — the 24.07 brief claimed "מלאי אופטימלי" off exactly
    // this ambiguity while the gap analysis actually had 22 items.
    return { count: null as number | null, items: [] as any[], failed: true }
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

    // Build prompt. Every comparison is labeled with its exact period, the
    // open-quotes KPI carries its "accumulated, never cleaned" caveat, and a
    // failed gap fetch is stated as unavailable — three lessons from the 24.07
    // brief that reported a "34% annual collapse" (July-only dip; annual was
    // flat), a 68K-quote "task force" (all-time pile), and "מלאי אופטימלי"
    // (gap fetch had failed; there were 22 real gaps).
    const monthName = new Date().toLocaleDateString('he-IL', { month: 'long' })
    const prompt = `אתה מכין תקציר בוקר יומי עבור מנהל של מפיץ חלפי רכב (Jan Parts).
הנה הנתונים העדכניים${salesKpis.dataThrough ? ` (נתוני מכירות מעודכנים עד ${salesKpis.dataThrough})` : ''}:

**מכירות:**
- אתמול: ₪${Math.round(salesKpis.yesterdaySales.total).toLocaleString()} (${salesKpis.yesterdaySales.count} עסקאות)
- אותו יום בשבוע שעבר: ₪${Math.round(salesKpis.lastWeekSameDaySales.total).toLocaleString()} (${salesKpis.lastWeekSameDaySales.count} עסקאות)
- 7 הימים האחרונים: ₪${Math.round(salesKpis.weekSales.total).toLocaleString()} (${salesKpis.weekSales.count} עסקאות)
- ${monthName} עד כה: ₪${Math.round(salesKpis.monthSales.total).toLocaleString()} (${salesKpis.monthSales.count} עסקאות)
${salesKpis.yoyChange !== null ? `- ${monthName} לעומת ${monthName} אשתקד (חודש בודד בלבד!): ${salesKpis.yoyChange > 0 ? '+' : ''}${salesKpis.yoyChange}% (₪${Math.round(salesKpis.monthSales.total).toLocaleString()} לעומת ₪${Math.round(salesKpis.yearAgoMonthSales.total).toLocaleString()})` : ''}
${salesKpis.ytdYoy !== null ? `- מתחילת השנה עד היום לעומת אותה תקופה אשתקד (ההשוואה השנתית האמיתית): ${salesKpis.ytdYoy > 0 ? '+' : ''}${salesKpis.ytdYoy}% (₪${Math.round(salesKpis.ytdTotal ?? 0).toLocaleString()} לעומת ₪${Math.round(salesKpis.ytdPrevTotal ?? 0).toLocaleString()})` : ''}

**סטטוס תפעולי:**
- הצעות מחיר פתוחות: ${dashboardData?.open_quotes?.count ?? 'לא זמין'}${dashboardData?.open_quotes?.total ? ` (₪${Math.round(dashboardData.open_quotes.total).toLocaleString()})` : ''} — שים לב: מספר מצטבר רב-שנתי (הצעות לא נסגרות במערכת), לא צבר עסקאות אמיתי. אל תציג אותו כהזדמנות מכירה.
- תעודות משלוח פתוחות: ${dashboardData?.open_delivery_notes?.count ?? 'לא זמין'}

**לקוחות עם יתרת חוב גבוהה:**
${overdueCustomers.length > 0
  ? overdueCustomers.map(c => `- ${c.name}: ₪${Math.round(c.balance).toLocaleString()}`).join('\n')
  : '- אין נתונים זמינים'}

**פערי מלאי (פריטים שצוטטו אך לא במלאי):**
${gapData.failed
  ? '- נתוני הפערים לא זמינים הבוקר — אל תסיק שאין פערים!'
  : `- סה"כ פריטים חסרים: ${gapData.count}
${gapData.items.length > 0
  ? gapData.items.map(i => `- ${i.name} (${i.code}): צוטט ${i.times_quoted} פעמים, כמות ${i.qty_quoted}`).join('\n')
  : '- אין פערים קריטיים'}`}

**התראות מלאי (פריטים עם מלאי קריטי ומכירות פעילות):**
${stockAlerts.length > 0
  ? stockAlerts.map(a => `- ${a.name} (${a.code}): ${a.stock} יחידות במלאי, נמכרו ${a.soldThisYear} השנה`).join('\n')
  : '- אין התראות קריטיות'}

כתוב דו"ח בוקר יומי בעברית — זה דו"ח על יום העסקים שהסתיים אתמול, בפורמט קבוע.

מבנה קבוע (4-6 נקודות, כל אחת מתחילה באימוג'י שלה, בסדר הזה):
- 📊 אתמול: המכירות של אתמול מול אותו יום בשבוע שעבר. זו הנקודה הראשונה תמיד.
- 📈 תמונה גדולה: ${monthName} עד כה מול ${monthName} אשתקד, ומתחילת השנה מול אשתקד — משפט אחד לכל היותר על כל אחד.
- 🚚 תפעול: תעודות משלוח / דברים שדורשים טיפול היום (רק אם יש).
- ⚠️ לתשומת לב: פערי מלאי, חובות, התראות — או ציון שהנתון לא זמין הבוקר.

סגנון — עברית פשוטה, כמו שמנהל מדבר עם מנהל:
- משפטים קצרים. בלי סוגריים מקוננים, בלי מונחים כמו "מצטבר", "התקופה המקבילה", "נקודתית".
- תן סכומים בש"ח ליד כל טענה, לא רק אחוזים.
- דוגמה לניסוח טוב: "📊 אתמול מכרנו ₪41 אלף ב-58 עסקאות — פחות מ-₪52 אלף באותו יום בשבוע שעבר."
- דוגמה לניסוח רע (אל תכתוב כך): "מגמת המכירות השנתית (מצטבר מתחילת השנה לעומת התקופה המקבילה אשתקד) יציבה עם ירידה קלה".

כללי ברזל: ליד כל אחוז או השוואה ציין במפורש את התקופה שהיא מכסה (חודש בודד ≠ שנתי);
אל תמציא מסקנות שאינן נתמכות בנתונים שלמעלה; אם נתון מסומן כלא-זמין — אמור שהוא לא זמין.
החזר את התשובה כ-JSON בפורמט הבא בלבד (ללא markdown):
{"summary": "משפט סיכום כללי קצר", "bullets": ["📊 ...", "📈 ...", "🚚 ...", "⚠️ ..."]}`

    let parsed: { summary: string; bullets: string[] }
    try {
      const result = await generateTextWithFallback({
        system: SYSTEM_PROMPT_HE,
        prompt,
        // Hebrew tokenizes densely; 500 truncated the JSON mid-string, which then
        // leaked raw `{"summary": ...` into the UI. Give it room to close the JSON.
        maxOutputTokens: 1000,
        // gemini-3.6-flash is a thinking model that once emitted its REASONING as
        // syntactically-valid JSON ("JSON wrapper or markdown? Yes...** Final Output
        // Construction**") which sailed through parsing straight into the group chat.
        // Force JSON output mode and turn thinking off for this structured call.
        providerOptions: {
          google: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
        },
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
        // Sanity gate: a real brief is Hebrew prose. Meta/reasoning junk (English,
        // markdown emphasis, code fences, the word JSON) → deterministic fallback.
        const junk = (s: string) => /```|\*\*|\bJSON\b/i.test(s)
        if (!/[֐-׿]/.test(parsed.summary) || junk(parsed.summary)) {
          throw new Error('model returned non-Hebrew/meta summary')
        }
        parsed.bullets = parsed.bullets.filter((b) => /[֐-׿]/.test(b) && !junk(b))
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

    // Degraded = the whole sales layer came back empty (transient Neon failures on a
    // fresh container did exactly this on 24.07 and the brief reported ₪0 everywhere).
    // A genuinely-zero sales month is impossible for this business, so all-zero+null
    // means "data unavailable": don't cache it (no 4h poisoning) and tell the pusher
    // not to post it — the loop retries on its next tick.
    const degraded = salesKpis.monthSales.total === 0 && salesKpis.ytdTotal === null

    const briefData: MorningBriefCache = {
      summary: parsed.summary,
      bullets: parsed.bullets,
      generatedAt: new Date().toISOString(),
    }

    if (!degraded) {
      // Cache for 4 hours
      await setCache(CACHE_KEY, briefData, CACHE_TTL)
    } else {
      console.warn('[morning-brief] sales data layer empty — serving degraded, not caching')
    }

    return NextResponse.json({ ...briefData, cached: false, degraded })
  } catch (error) {
    console.error('[morning-brief] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate morning brief' },
      { status: 500 },
    )
  }
}
