export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params
    const { searchParams } = new URL(request.url)
    const days = Math.min(Number(searchParams.get('days') || '90'), 365)

    // FINAPI: GET /api/customers/{code}/purchases?days=N
    // Returns per-item aggregates: item_code, item_name, total_qty, total_value,
    // line_count, last_purchased, returned_qty (active year only).
    const data = await (client as any).get(
      `/api/customers/${encodeURIComponent(code)}/purchases`,
      { days }
    )

    return NextResponse.json(data)
  } catch (error) {
    console.error('[customer purchases]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', items: [] },
      { status: 500 }
    )
  }
}
