#!/usr/bin/env node
/**
 * In-process check of the /api/items/[code]/links route handler against the
 * real DB. partly.part_links contains ~106 Toyota<->PSA pairs including
 * SU001A0146 <-> 0816K8 ("NOTCHED TIMING BELT") — both directions must
 * return each other.
 *
 * Usage:  APP_SECRETS_ID=config npx tsx scripts/check-links-api.mjs
 * (needs AWS creds for Secrets Manager, or DATABASE_URL directly in env)
 */
import { GET } from '../app/api/items/[code]/links/route.ts'

const CODES = process.argv.slice(2).length ? process.argv.slice(2) : ['SU001A0146', '0816K8']

let failed = false
for (const code of CODES) {
  const res = await GET(new Request(`http://localhost/api/items/${code}/links`), {
    params: Promise.resolve({ code }),
  })
  const json = await res.json()
  console.log(`\n=== ${code} → ${json.links?.length ?? 0} link(s) ===`)
  console.log(JSON.stringify(json, null, 2))
  if (!json.links?.length) failed = true
}

// Cross-direction assertion for the known pair
if (CODES.includes('SU001A0146') && CODES.includes('0816K8')) {
  const get = async (code) => {
    const res = await GET(new Request(`http://localhost/x`), { params: Promise.resolve({ code }) })
    return (await res.json()).links.map((l) => l.code)
  }
  const [a, b] = await Promise.all([get('SU001A0146'), get('0816K8')])
  const ok = a.includes('0816K8') && b.includes('SU001A0146')
  console.log(`\nBidirectional SU001A0146 <-> 0816K8: ${ok ? 'PASS' : 'FAIL'}`)
  if (!ok) failed = true
}

process.exit(failed ? 1 : 0)
