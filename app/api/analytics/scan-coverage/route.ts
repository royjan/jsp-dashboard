export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getCached, setCache, tryAcquireLock, deleteCache } from '@/lib/redis-client'
import { loadScanCoverage, type CoveragePayload } from '@/lib/scan-coverage'

/**
 * GET /api/analytics/scan-coverage[?fresh=1]
 *
 * Active fleet (data.gov.il) × scanned catalogues (Partly) × prices — see lib/scan-coverage.ts.
 * The answer is ~70k model/year rows and costs ~1 min to build (two gov.il downloads plus
 * one pass over project_parts), and none of its inputs move faster than daily, so it is
 * cached for 12h. `fresh=1` rebuilds it (the page's refresh button).
 */
const KEY = 'scan-coverage:v1'
const TTL_S = 12 * 3600

export async function GET(req: NextRequest) {
  try {
    await initializeSecrets()
    const fresh = req.nextUrl.searchParams.get('fresh') === '1'
    if (!fresh) {
      const hit = await getCached<CoveragePayload>(KEY)
      if (hit) return NextResponse.json(hit)
    }
    // One builder at a time; a second caller gets the previous answer if there is one.
    if (!(await tryAcquireLock(`${KEY}:lock`, 300))) {
      const hit = await getCached<CoveragePayload>(KEY)
      if (hit) return NextResponse.json(hit)
      return NextResponse.json({ error: 'building, retry in a minute' }, { status: 503 })
    }
    try {
      const value = await loadScanCoverage()
      await setCache(KEY, value, TTL_S)
      return NextResponse.json(value)
    } finally {
      await deleteCache(`${KEY}:lock`)
    }
  } catch (e) {
    console.error('[scan-coverage] failed:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'scan coverage failed' }, { status: 500 })
  }
}
