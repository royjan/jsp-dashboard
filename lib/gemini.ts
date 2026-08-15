import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { generateText as generateTextType } from 'ai'
import { getSecret } from './aws-secrets'

// Primary/fallback for ALL Gemini usage (user decision 2026-07-22): 3.6-flash first,
// 3.5-flash when the primary errors. Env-overridable for instant rollback.
const GEMINI_PRIMARY = process.env.GEMINI_MODEL || 'gemini-3.7-flash'
const GEMINI_FALLBACK = process.env.GEMINI_MODEL_FALLBACK || 'gemini-3.5-flash'

function google() {
  const apiKey = getSecret('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  return createGoogleGenerativeAI({ apiKey })
}

export function getGeminiFlash() {
  return google()(GEMINI_PRIMARY)
}

export function getGeminiFallback() {
  return google()(GEMINI_FALLBACK)
}

/** Kept for API stability — the "pro" tier is also pinned to the primary flash model now. */
export function getGeminiPro() {
  return google()(GEMINI_PRIMARY)
}

type GenerateArgs = Omit<Parameters<typeof generateTextType>[0], 'model'>

/** generateText on the primary model, retried once on the fallback when it errors
 *  (quota / 5xx / model rollout). Streaming callers stay on the primary — a stream
 *  can't be transparently restarted once chunks were sent. */
export async function generateTextWithFallback(args: GenerateArgs) {
  const { generateText } = await import('ai')
  try {
    return await generateText({ ...(args as object), model: getGeminiFlash() } as Parameters<typeof generateTextType>[0])
  } catch (e) {
    console.warn(`[gemini] ${GEMINI_PRIMARY} failed, falling back to ${GEMINI_FALLBACK}:`, e instanceof Error ? e.message : e)
    return await generateText({ ...(args as object), model: getGeminiFallback() } as Parameters<typeof generateTextType>[0])
  }
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
  const from = LANG_NAMES[sourceLanguage] || sourceLanguage
  const to = LANG_NAMES[targetLanguage] || targetLanguage
  const prompt = `You are translating automotive spare-part terminology for an Israeli auto-parts distributor.
Translate the following ${from} term to ${to}. This is a car-parts catalog term (e.g. "oil filter", "brake pad").
Reply with ONLY the translated term, lowercase if English, no quotes, no explanation.

Term: ${sourceWord}`
  const { text } = await generateTextWithFallback({ prompt })
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
