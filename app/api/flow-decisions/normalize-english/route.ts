import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { normalizeFlowDescriptionsToEnglish } from '@/lib/chat-admin/normalize-english'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** POST /api/flow-decisions/normalize-english?dryRun=1 — translate every non-English
 *  part_description to English (all statuses), delete true duplicates (keep newest), re-embed. */
export async function POST(req: Request) {
  try {
    await initializeSecrets()
    const dryRun = new URL(req.url).searchParams.get('dryRun') != null
    const result = await normalizeFlowDescriptionsToEnglish({ dryRun })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[flow-decisions/normalize-english] failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
