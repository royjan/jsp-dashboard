import { streamText } from 'ai'
import { getGeminiFlash, getGeminiPro, SYSTEM_PROMPT_HE } from '../gemini'
import { getItems } from './analytics-service'
import { getCached, setCache } from '../redis-client'
import { CACHE_TTL } from '../constants'
import type { AIInsight } from '../types'

export async function generateInsights(skipCache = false): Promise<AIInsight[]> {
  const cacheKey = 'ai:insights:he'
  if (!skipCache) {
    const cached = await getCached<AIInsight[]>(cacheKey)
    if (cached) return cached
  }

  const items = await getItems()

  const topDemand = items
    .sort((a, b) => b.inquiry_count - a.inquiry_count)
    .slice(0, 20)
    .map(i => ({ code: i.code, name: i.name, inquiries: i.inquiry_count, stock: i.stock_qty, sold: i.sold_this_year }))

  const lowStock = items
    .filter(i => i.stock_qty < 5 && (i.inquiry_count > 3 || i.sold_this_year > 0))
    .slice(0, 10)
    .map(i => ({ code: i.code, name: i.name, stock: i.stock_qty, inquiries: i.inquiry_count }))

  const deadStock = items
    .filter(i => i.stock_qty > 0 && i.sold_this_year === 0 && i.sold_last_year === 0)
    .sort((a, b) => (b.stock_qty * b.price) - (a.stock_qty * a.price))
    .slice(0, 10)
    .map(i => ({ code: i.code, name: i.name, stock: i.stock_qty, value: i.stock_qty * i.price }))

  const prompt = `נתח את נתוני המלאי הבאים וצור 5-8 תובנות בעברית.

פריטים מבוקשים ביותר:
${JSON.stringify(topDemand, null, 2)}

מלאי נמוך עם ביקוש גבוה:
${JSON.stringify(lowStock, null, 2)}

מלאי מת (הון כלוא הגבוה ביותר):
${JSON.stringify(deadStock, null, 2)}

צור תובנות כמערך JSON עם הסכמה הבאה:
[{ "type": "demand_spike"|"seasonal_prediction"|"dead_stock_warning"|"reorder_urgency", "severity": "info"|"warning"|"critical", "title": "כותרת קצרה בעברית", "description": "תיאור מעשי בעברית", "related_items": ["ITEM_CODE1", "ITEM_CODE2"] }]

החזר רק את מערך ה-JSON, ללא markdown או הסבר.`

  try {
    const model = getGeminiFlash()
    const result = await streamText({ model, system: SYSTEM_PROMPT_HE, prompt })
    let text = ''
    for await (const chunk of result.textStream) {
      text += chunk
    }

    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const insights: AIInsight[] = JSON.parse(jsonMatch[0]).map((i: any, idx: number) => ({
        ...i,
        id: `insight-${Date.now()}-${idx}`,
        created_at: new Date().toISOString(),
      }))
      await setCache(cacheKey, insights, CACHE_TTL.AI_INSIGHTS)
      return insights
    }
  } catch (error) {
    console.error('[AI Insights] Failed:', error)
  }

  return []
}

export function streamReorderAnalysis(items: any[]) {
  const model = getGeminiPro()
  const prompt = `נתח את הפריטים הבאים עבור המלצות הזמנה מחדש:
${JSON.stringify(items.slice(0, 30), null, 2)}

עבור כל פריט, שקול:
1. מלאי נוכחי מול מהירות ביקוש
2. דפוסים עונתיים ישראליים (חלקי מיזוג שיא מאי-אוקטובר, מגבים/בלמים נובמבר-אפריל)
3. הערכות זמן אספקה לחלקי רכב
4. יעילות הון

ספק המלצות ספציפיות עם כמויות ותזמון.`

  return streamText({ model, system: SYSTEM_PROMPT_HE, prompt })
}

export function streamStockOptimization(deadStock: any[], stockHealth: any) {
  const model = getGeminiPro()
  const prompt = `נתח הזדמנויות לאופטימיזציית מלאי:

מלאי מת (ללא מכירות שנה+):
${JSON.stringify(deadStock.slice(0, 20), null, 2)}

המלץ:
1. אילו פריטים לחסל (מבצע הנחה) ואחוז הנחה מומלץ
2. אילו פריטים להחזיר לספקים
3. אילו פריטים לשמור (עונתיים או ביקוש צפוי)
4. סך ההון שניתן לשחרר

התחשב בייחודיות השוק הישראלי ונורמות תעשיית חלפי הרכב.`

  return streamText({ model, system: SYSTEM_PROMPT_HE, prompt })
}
