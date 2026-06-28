import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { translateTerm } from '@/lib/gemini'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/word-mappings/translate
 * Body: { sourceWord, sourceLanguage, targetLanguage }
 * Returns: { translation, source: 'chain' | 'llm' }
 *
 * Tries an existing DB mapping first (direct, then synonym pivot), then falls
 * back to a Gemini translation. Read-only — does not create mappings.
 */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { sourceWord, sourceLanguage, targetLanguage } = body
    if (!sourceWord || !sourceLanguage || !targetLanguage) {
      return NextResponse.json(
        { error: 'Missing required fields: sourceWord, sourceLanguage, targetLanguage' },
        { status: 400 },
      )
    }

    const normalized = sourceLanguage === 'en' ? sourceWord.trim().toLowerCase() : sourceWord.trim()

    // 1. Direct existing mapping (prefer default, then highest usage)
    const direct = await query(
      `SELECT target_word FROM word_mappings
       WHERE source_word = $1 AND source_language = $2 AND target_language = $3 AND is_active = true
       ORDER BY is_default DESC, usage_count DESC
       LIMIT 1`,
      [normalized, sourceLanguage, targetLanguage],
    )
    if (direct.rows[0]?.target_word) {
      return NextResponse.json({ translation: direct.rows[0].target_word, source: 'chain' })
    }

    // 2. LLM fallback (Gemini)
    try {
      const translation = await translateTerm(sourceWord.trim(), sourceLanguage, targetLanguage)
      if (!translation) {
        return NextResponse.json({ error: 'No translation produced' }, { status: 422 })
      }
      return NextResponse.json({ translation, source: 'llm' })
    } catch (llmErr) {
      console.error('Translate LLM error:', llmErr)
      return NextResponse.json(
        { error: 'Translation service unavailable (GEMINI_API_KEY not configured?)' },
        { status: 503 },
      )
    }
  } catch (error) {
    console.error('Error translating word:', error)
    return NextResponse.json({ error: 'Failed to translate' }, { status: 500 })
  }
}
