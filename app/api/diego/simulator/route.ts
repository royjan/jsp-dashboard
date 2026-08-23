import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getSimOverview, getSimCases } from '@/lib/chat-admin/simulator'

export const dynamic = 'force-dynamic'

/**
 * GET /api/diego/simulator            -> recent runs, per-domain scores, trend, failing checks
 * GET /api/diego/simulator?run=<id>   -> every case of that run (omit `run` for the latest)
 */
export async function GET(req: NextRequest) {
  try {
    await initializeSecrets()
    const sp = req.nextUrl.searchParams
    if (sp.has('run') || sp.has('cases')) {
      const { run, cases } = await getSimCases(sp.get('run') ?? undefined)
      return NextResponse.json({ success: true, run, cases })
    }
    const overview = await getSimOverview(
      sp.get('limit') ? Number(sp.get('limit')) : undefined)
    return NextResponse.json({ success: true, ...overview })
  } catch (e) {
    // The tables only exist once sim_run.py has stored a run; an empty dashboard is a
    // better answer than a 500 for someone who has not run the simulator yet.
    const msg = e instanceof Error ? e.message : String(e)
    if (/relation .*sim_(runs|cases).* does not exist/i.test(msg)) {
      return NextResponse.json({ success: true, runs: [], latest: null, byDomain: [],
                                 latency: null, trend: [], failingChecks: [],
                                 notRunYet: true })
    }
    console.error('[api/diego/simulator]', e)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
