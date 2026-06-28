import { NextRequest } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getGeminiFlash } from '@/lib/gemini'
import { getCached, setCache } from '@/lib/redis-client'

export const runtime = 'nodejs'
export const maxDuration = 45

// Dashboard pages the playbook may link to. The model must pick hrefs ONLY from
// this list so links always resolve.
const PAGES = `
/scrap — מלאי מת: 50 הפריטים הגדולים למכירת חיסול, היסטוריית מכירות 4 שנים, הון כלוא
/stock — אופטימיזציית מלאי, מלאי עודף, מחזור מלאי
/stock-forecast — תחזית ביקוש, פריטים להזמנה / מלאי עודף
/reorder — המלצות הזמנה מבוססות AI
/customers — לקוחות מובילים, ניתוח נטישה (churn), מגמות הכנסה (win-back)
/receivables — גיול חובות (AR aging), חובות באיחור
/gap — פריטים שצוטטו ואין במלאי (פערי שרשרת אספקה)
/margin — ניתוח רווחיות
/conversion — המרת הצעות מחיר לחשבוניות
/sales-rep — כלי נציג מכירות
`.trim()

interface Playbook {
  summary: string
  steps: string[]
  links: { label: string; href: string }[]
  timeline: string
  owner: string
  risk: string
}

function buildPrompt(action: string, impact: string, locale: string): string {
  const lang = locale === 'en' ? 'English' : 'Hebrew'
  return `You are the operations advisor for Jan Parts (ג'אן חלקים), an Israeli auto-parts distributor.
A business report lists this recommended action and its expected impact:

  Action: ${action}
  Expected impact: ${impact}

Turn it into a concrete, executable playbook for the team — exactly WHAT to do, step by step,
using the company's own analytics dashboard. Be specific and operational, not generic advice.

The dashboard has these pages (choose links ONLY from this list, copy the href verbatim):
${PAGES}

Reply with ONLY a JSON object (no markdown fences) in this exact shape, written in ${lang}:
{
  "summary": "one sentence: what this action really means and why it matters",
  "steps": ["concrete step 1", "concrete step 2", "concrete step 3", "concrete step 4"],
  "links": [{"label": "short label", "href": "/scrap"}],
  "timeline": "realistic timeframe, e.g. 1-2 שבועות",
  "owner": "who should own this, e.g. מנהל מלאי",
  "risk": "the main risk or caveat to watch"
}
Rules: 3-6 steps, each a real action a person can take this week. 1-3 links, all from the list above.
Keep every field tight. JSON only.`
}

function parsePlaybook(text: string): Playbook | null {
  try {
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1) return null
    const obj = JSON.parse(cleaned.slice(start, end + 1))
    if (!Array.isArray(obj.steps)) return null
    // Keep only links whose href is one of our known pages.
    const valid = new Set(PAGES.split('\n').map((l) => l.trim().split(' ')[0]))
    obj.links = (Array.isArray(obj.links) ? obj.links : []).filter(
      (l: { href?: string }) => l?.href && valid.has(l.href.split('?')[0])
    )
    return obj as Playbook
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const { action, impact, locale = 'he', force } = await request.json()
    if (!action) return Response.json({ error: 'action required' }, { status: 400 })

    const key = `ai:action-playbook:${locale}:${Buffer.from(action).toString('base64').slice(0, 48)}`
    if (!force) {
      const cached = await getCached<Playbook>(key)
      if (cached) return Response.json({ playbook: cached, cached: true })
    }

    const { generateText } = await import('ai')
    const { text } = await generateText({
      model: getGeminiFlash(),
      prompt: buildPrompt(action, impact || '', locale),
    })

    const playbook = parsePlaybook(text)
    if (!playbook) return Response.json({ error: 'Failed to generate playbook' }, { status: 502 })

    await setCache(key, playbook, 7 * 24 * 60 * 60) // 7 days — recommendations are stable
    return Response.json({ playbook, cached: false })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
