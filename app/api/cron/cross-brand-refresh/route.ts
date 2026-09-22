export const maxDuration = 300

import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { refreshCrossBrand } from '@/lib/cross-brand'

export const dynamic = 'force-dynamic'

/**
 * Rebuild the cross-brand graph in Redis.
 *
 * The catalog changes when a scan lands (nightly imports, the scan-asked job)
 * and the ERP mirror is refreshed nightly, so once a night is the right
 * cadence: jan-cross-brand-refresh.timer on jan-box calls this through
 * jan-cron-call after both have run. The page then reads one Redis key.
 */
export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  await initializeSecrets()
  const secret = getSecret('CRON_SECRET')
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  try {
    const data = await refreshCrossBrand()
    return NextResponse.json({
      ok: true,
      codes: data.codes.length,
      matches: data.matches.length,
      brands: Object.keys(data.brandTotals).length,
      computedAt: data.computedAt,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    })
  } catch (e) {
    console.error('[cross-brand-refresh] Error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'refresh failed' }, { status: 500 })
  }
}
