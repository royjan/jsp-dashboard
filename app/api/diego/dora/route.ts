import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { listDoraThreads, getDoraThread } from '@/lib/chat-admin/diego-sessions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/diego/dora            -> Dora threads, one per customer (newest activity first)
 * GET /api/diego/dora?user=<id>  -> that customer's full cross-session event stream
 */
export async function GET(req: NextRequest) {
  try {
    await initializeSecrets()
    const user = req.nextUrl.searchParams.get('user')
    if (user) {
      const events = await getDoraThread(user)
      return NextResponse.json({ success: true, events })
    }
    const threads = await listDoraThreads()
    return NextResponse.json({ success: true, threads })
  } catch (e) {
    console.error('[diego/dora]', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
