export const maxDuration = 300

import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { refreshLiveYear } from '@/lib/books/load'
import { getLiveYear } from '@/lib/services/books-service'

export const dynamic = 'force-dynamic'

/**
 * Top the live year up from the ERP.
 *
 * Closed years never move; the active year gains postings all day. This walks
 * the tail of the ledger and VAT files — the recent end — and re-reads the
 * small cash and bank files whole, merging everything on the record
 * fingerprint so a settled invoice replaces its own row instead of duplicating.
 *
 * Called by the in-process loop (lib/books-refresh-loop.ts) and available by
 * hand when someone wants the books current right now.
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
    const url = new URL(request.url)
    const year = Number(url.searchParams.get('year')) || await getLiveYear()
    const tail = Number(url.searchParams.get('tail')) || 6_000
    // Cached views key off the year's watermark, which this bumps — so the
    // refresh invalidates them without having to know every date window a
    // viewer has looked at.
    const merged = await refreshLiveYear(year, tail)

    return NextResponse.json({
      ok: true, year, merged, seconds: Math.round((Date.now() - started) / 100) / 10,
    })
  } catch (e) {
    console.error('[books-refresh] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'refresh failed' }, { status: 500 })
  }
}
