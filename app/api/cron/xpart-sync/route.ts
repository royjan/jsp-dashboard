export const maxDuration = 600 // the ERP catalog stream alone takes ~70s

import { NextRequest, NextResponse } from 'next/server'
import { runXpartSync } from '@/lib/xpart/sync'
import { getSecret, initializeSecrets } from '@/lib/aws-secrets'

/**
 * GET /api/cron/xpart-sync
 *
 * Pulls Xpart-v2's supplier prices, supersession chains and unlisted part
 * numbers into the dashboard schema, and merges its supplier records onto our
 * own supplier_profiles. Read-only on both Xpart and Finansit; the only writes
 * are to dashboard.xpart_* and the additive supplier_profiles merge.
 *
 * Nightly is right: supplier lists are monthly, chains rarer still.
 */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const cronSecret = getSecret('CRON_SECRET')
    if (cronSecret) {
      const authHeader = request.headers.get('authorization')
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
      if (token !== cronSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    const result = await runXpartSync()
    console.log('[xpart-sync]', JSON.stringify(result))
    return NextResponse.json({ ...result, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.error('[xpart-sync] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
