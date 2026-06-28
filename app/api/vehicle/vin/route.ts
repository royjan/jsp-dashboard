import { NextResponse } from 'next/server'

/**
 * VIN decode is deferred in the dashboard — it requires the chat vehicle Lambda
 * services (AWS Lambda + government API) that are out of scope here. The
 * simulator works from manually entered vehicle fields instead.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'VIN decode is not available in the dashboard. Enter vehicle fields manually.' },
    { status: 501 },
  )
}
export const POST = GET
