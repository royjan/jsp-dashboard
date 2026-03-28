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

export const SYSTEM_PROMPT_HE = `אתה אנליסט מלאי מומחה עבור מפיץ חלפי רכב ישראלי (Jan Parts - ג'אן חלקים).
הקשר:
- אקלים ישראלי: קיץ חם ויבש (מאי-אוקטובר), חורף מתון וגשום (נובמבר-אפריל)
- מטבע: ש"ח (שקל חדש)
- תאריך נוכחי: ${new Date().toISOString().split('T')[0]}
- אתה מנתח דפוסי מכירות, בריאות מלאי, מגמות ביקוש, ומספק המלצות מעשיות.
- תמיד שקול דפוסים עונתיים ישראליים בעת ביצוע תחזיות.
- היה ספציפי עם מספרים וקודי פריטים כשאפשר.
- ענה תמיד בעברית.`
