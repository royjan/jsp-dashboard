import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getPendingSuggestions } from '@/lib/chat-admin/word-mappings'

export const dynamic = 'force-dynamic'

/** GET /api/admin/word-mappings/suggestions — pending suggestions */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const suggestions = await getPendingSuggestions(limit)
    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error fetching suggestions:', error)
    return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 })
  }
}

/**
 * POST /api/admin/word-mappings/suggestions — generate suggestions.
 * Deferred for v1: the chat generator mines chat_history with heuristics not
 * yet ported. Returns 501 so the UI surfaces a clear message instead of 500.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Suggestion generation is not available in the dashboard yet' },
    { status: 501 },
  )
}
