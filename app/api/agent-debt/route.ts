import { NextResponse } from 'next/server'
import { fetchAgentDebtReport } from '@/lib/finansit-client'
import { requireReader } from '@/lib/vehicle-twins-proxy'

export const dynamic = 'force-dynamic'
// A fresh 7UPD + 7ACC scan on .109 is ~20 s; FINAPI caches the report for 15 minutes.
export const maxDuration = 120

const AREAS = ['השרון', 'צפון', 'דרום', 'ירושלים', 'מרכז', 'אילת והסביבה', 'רשות פלסטינאית', 'לא משויך']

/**
 * GET → FINAPI's agent debt report (JSON form of /api/export/agent-debt), from the AR box.
 * Customer debt is not for anonymous LAN callers: signed-in viewers only.
 */
export async function GET(req: Request) {
  const gate = await requireReader()
  if ('res' in gate) return gate.res
  const sp = new URL(req.url).searchParams
  const area = sp.get('area') || ''
  if (area && !AREAS.includes(area)) {
    return NextResponse.json({ error: `area must be one of ${AREAS.join(', ')}` }, { status: 400 })
  }
  const months = Math.min(12, Math.max(1, Number(sp.get('months') || 3) || 3))
  try {
    const report = await fetchAgentDebtReport({
      area: area || undefined,
      months,
      include_zero: sp.get('include_zero') === '1',
      refresh: sp.get('refresh') === '1',
    })
    return NextResponse.json(report)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `דוח החובות לא זמין כרגע (${msg.slice(0, 160)})` }, { status: 502 })
  }
}
