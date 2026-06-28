import { NextResponse } from 'next/server'

/** VIN17 decode is deferred in the dashboard (see /api/vehicle/vin). */
export async function GET() {
  return NextResponse.json(
    { error: 'VIN decode is not available in the dashboard. Enter vehicle fields manually.' },
    { status: 501 },
  )
}
export const POST = GET
