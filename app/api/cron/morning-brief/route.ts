import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { getCached } from '@/lib/redis-client'
import { forceMorningBriefPost } from '@/lib/morning-brief-push'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Manual companion to the self-scheduling morning-brief loop (lib/morning-brief-push.ts —
 * the loop itself runs in-process, this is NOT a scheduled cron):
 *   GET ?mode=status  -> last heartbeat
 *   GET ?force=1      -> post the brief to the staff group NOW (rollout test / re-send)
 * Auth: Bearer CRON_SECRET when configured (same convention as warm-cache).
 */
export async function GET(req: NextRequest) {
  try {
    await initializeSecrets()
    const secret = getSecret('CRON_SECRET', '')
    if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
    }
    if (req.nextUrl.searchParams.get('force') === '1') {
      await forceMorningBriefPost()
      return NextResponse.json({ success: true, posted: true })
    }
    const status = await getCached('morning-brief:status')
    return NextResponse.json({ success: true, status: status ?? 'no heartbeat yet' })
  } catch (e) {
    console.error('[cron/morning-brief]', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
