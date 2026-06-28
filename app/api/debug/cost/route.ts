import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

// TEMPORARY probe: learn how FINAPI exposes the cost price (price_code 7ITP)
// vs the default sell price, so the margin route can be wired correctly.
// Remove once margin is verified.
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  try {
    await initializeSecrets()
    const code = (new URL(req.url).searchParams.get('code') || '').toUpperCase()
    if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

    const out: Record<string, unknown> = { code }

    // 1. default batch (sell price source the dashboard already uses)
    try {
      out.batch_default = await client.prices.batch({ item_codes: [code] } as any)
    } catch (e) {
      out.batch_default_err = String(e)
    }
    // 2. batch with price_code 7ITP
    try {
      out.batch_7itp = await client.prices.batch({ item_codes: [code], price_code: '7ITP' } as any)
    } catch (e) {
      out.batch_7itp_err = String(e)
    }
    // 3. lookup with price_code 7ITP
    try {
      out.lookup_7itp = await client.prices.lookup(code, { price_code: '7ITP' } as any)
    } catch (e) {
      out.lookup_7itp_err = String(e)
    }
    // 4. lookup default
    try {
      out.lookup_default = await client.prices.lookup(code, {} as any)
    } catch (e) {
      out.lookup_default_err = String(e)
    }
    // 5. live-stock shape — what fields (qty/price/cost?) does stock.getAll return?
    try {
      const data = await client.stock.getAll()
      const items: any[] = data.items || data || []
      out.stock_count = items.length
      out.stock_sample = items.slice(0, 3)
      out.stock_match = items.filter((it: any) => (it.item_code || it.code) === code).slice(0, 1)
    } catch (e) {
      out.stock_err = String(e)
    }

    return NextResponse.json(out)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
