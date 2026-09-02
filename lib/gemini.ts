import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { generateText as generateTextType } from 'ai'
import { getSecret } from './aws-secrets'

// Primary/fallback for ALL Gemini usage: 3.8-flash first (2026-09-02; 3.7 before it, 3.6
// before that), 3.5-flash when the primary errors. Env-overridable for instant rollback.
const GEMINI_PRIMARY = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
const GEMINI_FALLBACK = process.env.GEMINI_MODEL_FALLBACK || 'gemini-3.5-flash'
// Every call names its thinking level. Gemini 3.8 otherwise defaults to `medium`, the slowest
// setting on short calls (benched 2026-09-02); `low` is the cheapest level 3.7/3.8 accept and
// 3.5 accepts it too, so the same option is legal on the fallback. `minimal` is a 400 on 3.7+.
const GEMINI_THINKING_LEVEL = (process.env.GEMINI_THINKING_LEVEL || 'low') as 'minimal' | 'low' | 'medium' | 'high'

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
  // A caller's own google options win field by field, but the thinking level is always set.
  const callerGoogle = ((args as { providerOptions?: { google?: Record<string, unknown> } }).providerOptions?.google) || {}
  const withThinking = {
    ...(args as object),
    providerOptions: {
      ...((args as { providerOptions?: object }).providerOptions || {}),
      google: { thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL }, ...callerGoogle },
    },
  }
  try {
    return await generateText({ ...withThinking, model: getGeminiFlash() } as unknown as Parameters<typeof generateTextType>[0])
  } catch (e) {
    console.warn(`[gemini] ${GEMINI_PRIMARY} failed, falling back to ${GEMINI_FALLBACK}:`, e instanceof Error ? e.message : e)
    return await generateText({ ...withThinking, model: getGeminiFallback() } as unknown as Parameters<typeof generateTextType>[0])
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
