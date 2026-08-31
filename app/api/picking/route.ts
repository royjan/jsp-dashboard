import { NextResponse } from 'next/server'
import { pickQueue, stockDisputes, shippingHistory, InvagentUnavailable } from '@/lib/invagent'

export const dynamic = 'force-dynamic'

/**
 * The picking floor: what is still being picked, what pickers could not find,
 * and what shipped.
 *
 * Server-side on purpose — the Supabase service_role key never reaches the
 * browser, and the anon key cannot substitute for it (RLS returns an empty
 * array rather than a 403, which would render as an idle warehouse).
 *
 * A source that could not be consulted answers 503 with `sourceAvailable:
 * false`, never 200 with empty arrays. The page renders that as an outage.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined

  try {
    const [queue, disputes, shipped] = await Promise.all([
      pickQueue(),
      stockDisputes(from),
      shippingHistory(from, to),
    ])
    return NextResponse.json({ sourceAvailable: true, queue, disputes, shipped })
  } catch (error) {
    if (error instanceof InvagentUnavailable) {
      // The cause goes to the log, where whoever can fix it is looking. The
      // response carries only what a warehouse user can do something with —
      // and never the name of a missing secret.
      console.warn('[picking] invagent unavailable:', error.message)
      return NextResponse.json(
        { sourceAvailable: false, reason: error.userMessage },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch picking data' },
      { status: 500 },
    )
  }
}
