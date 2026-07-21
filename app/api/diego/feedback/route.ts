import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { listDiegoFeedback } from '@/lib/chat-admin/diego-sessions'

export const dynamic = 'force-dynamic'

/** GET /api/diego/feedback — customer 👍/👎 events, newest first, with session deep-link data. */
export async function GET() {
  try {
    await initializeSecrets()
    const feedback = await listDiegoFeedback()
    return NextResponse.json({ success: true, feedback })
  } catch (e) {
    console.error('[diego/feedback]', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
