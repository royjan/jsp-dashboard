import { streamText } from 'ai'
import { NextRequest } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getGeminiPro, SYSTEM_PROMPT_HE } from '@/lib/gemini'
import { getCached, setCache } from '@/lib/redis-client'

export const runtime = 'nodejs'
export const maxDuration = 60

// Lightweight cache-check: returns cached insight text if available, 404 if not
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const url = new URL(request.url)
    const key = url.searchParams.get('key')
    if (!key) return new Response(null, { status: 400 })
    const cached = await getCached<{ text: string; ts: number }>(key)
    if (!cached) return new Response(null, { status: 404 })
    return Response.json({ text: cached.text, ts: cached.ts })
  } catch {
    return new Response(null, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const body = await request.json()
    const { summary, capital_by_class, a_items_at_risk_enriched, c_items_overstock, force } = body

    const cacheKey = `ai:abc-insights:${summary.a_count}:${summary.b_count}:${summary.c_count}:${Math.round(summary.total_revenue / 100000)}`

    if (!force) {
      const cached = await getCached<{ text: string; ts: number }>(cacheKey)
      if (cached) {
        const stream = new ReadableStream({
          start(c) { c.enqueue(new TextEncoder().encode(cached.text)); c.close() },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Cache-Timestamp': cached.ts.toString(),
          },
        })
      }
    }

    const aAtRiskSample = (a_items_at_risk_enriched || []).slice(0, 8)
    const cOverstockSample = (c_items_overstock || []).slice(0, 8).map((i: any) => ({
      code: i.code, name: i.name, stock: i.stock_qty, capital: Math.round(i.capital_tied), last_sale: i.sale_date?.substring(0, 10),
    }))

    const prompt = `להלן נתוני סיווג ABC של מלאי חלפי הרכב שלנו:

**סיכום:**
- פריטי A: ${summary.a_count} פריטים → ${summary.a_revenue_pct}% מההכנסות, ${Math.round((capital_by_class.a_capital / capital_by_class.total_capital) * 100)}% מההון
- פריטי B: ${summary.b_count} פריטים → ${summary.b_revenue_pct}% מההכנסות, ${Math.round((capital_by_class.b_capital / capital_by_class.total_capital) * 100)}% מההון
- פריטי C: ${summary.c_count} פריטים → ${summary.c_revenue_pct}% מההכנסות, ${Math.round((capital_by_class.c_capital / capital_by_class.total_capital) * 100)}% מההון
- סה"כ הכנסות: ₪${Math.round(summary.total_revenue).toLocaleString()}
- סה"כ הון כלוא: ₪${Math.round(capital_by_class.total_capital).toLocaleString()}

**פריטי A בסיכון — כולל קודים חלופיים עם מלאי אם קיימים:**
${JSON.stringify(aAtRiskSample, null, 2)}

חשוב: אם aliases_with_stock אינו ריק עבור פריט, הפריט קיים במלאי תחת קוד חלופי — ציין זאת במפורש במקום להתריע על חוסר מלאי. כל קודי הפריטים הם אותו פריט פיזי בדיוק, רק תחת מזהה אחר.

**פריטי C עודפים (הון ישן כלוא):**
${JSON.stringify(cOverstockSample, null, 2)}

כתוב ניתוח קצר ומעשי בעברית — 3-4 פסקאות. כלול:
1. מה רואים בסיווג — האם ה-80/20 תקין? האם פריטי A מקבלים יחס מספיק?
2. מה דחוף — פריטי A בסיכון (השלכות הכנסות)
3. מה אפשר לשחרר — פריטי C עודפים (שחרור הון)
4. המלצה אחת ממוקדת לצעד הבא

היה תמציתי, ספציפי, ולא כתוב נקודות — כתוב זרם טבעי של פסקאות קצרות.`

    const now = Date.now()
    const result = streamText({
      model: getGeminiPro(),
      system: SYSTEM_PROMPT_HE,
      prompt,
      maxTokens: 800,
    })
    result.text.then(t => setCache(cacheKey, { text: t, ts: now }, 7 * 24 * 60 * 60)).catch(() => {})

    const streamResponse = result.toTextStreamResponse()
    const headers = new Headers(streamResponse.headers)
    headers.set('X-Cache-Timestamp', now.toString())
    return new Response(streamResponse.body, { headers, status: streamResponse.status })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
