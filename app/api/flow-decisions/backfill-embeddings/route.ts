import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { backfillEmbeddings } from '@/lib/chat-admin/flow-decisions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Embedding up to 500 descriptions sequentially (10s timeout each) can take a while.
export const maxDuration = 300

/** POST /api/flow-decisions/backfill-embeddings — fill missing part_descriptions embeddings. */
export async function POST() {
  try {
    await initializeSecrets()
    const result = await backfillEmbeddings()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[flow-decisions/backfill-embeddings] failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
