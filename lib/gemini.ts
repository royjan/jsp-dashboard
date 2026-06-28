import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getSecret } from './aws-secrets'

export function getGeminiFlash() {
  const apiKey = getSecret('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  const google = createGoogleGenerativeAI({ apiKey })
  return google('gemini-3-flash-preview')
}

export function getGeminiPro() {
  const apiKey = getSecret('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  const google = createGoogleGenerativeAI({ apiKey })
  return google('gemini-3.1-pro-preview')
}

const LANG_NAMES: Record<string, string> = { en: 'English', he: 'Hebrew', zh: 'Chinese' }

/**
 * Translate a single auto-parts term between languages using Gemini.
 * Returns the translated term only. Throws if GEMINI_API_KEY is not
 * configured (caller degrades gracefully).
 */
export async function translateTerm(
  sourceWord: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  const { generateText } = await import('ai')
  const from = LANG_NAMES[sourceLanguage] || sourceLanguage
  const to = LANG_NAMES[targetLanguage] || targetLanguage
  const prompt = `You are translating automotive spare-part terminology for an Israeli auto-parts distributor.
Translate the following ${from} term to ${to}. This is a car-parts catalog term (e.g. "oil filter", "brake pad").
Reply with ONLY the translated term, lowercase if English, no quotes, no explanation.

Term: ${sourceWord}`
  const { text } = await generateText({ model: getGeminiFlash(), prompt })
  return text.trim().replace(/^["']|["']$/g, '').split('\n')[0].trim()
}

export const SYSTEM_PROMPT_HE = `אתה אנליסט מלאי מומחה עבור מפיץ חלפי רכב ישראלי (Jan Parts - ג'אן חלקים).
הקשר:
- אקלים ישראלי: קיץ חם ויבש (מאי-אוקטובר), חורף מתון וגשום (נובמבר-אפריל)
- מטבע: ש"ח (שקל חדש)
- תאריך נוכחי: ${new Date().toISOString().split('T')[0]}
- אתה מנתח דפוסי מכירות, בריאות מלאי, מגמות ביקוש, ומספק המלצות מעשיות.
- תמיד שקול דפוסים עונתיים ישראליים בעת ביצוע תחזיות.
- היה ספציפי עם מספרים וקודי פריטים כשאפשר.
- ענה תמיד בעברית.`
