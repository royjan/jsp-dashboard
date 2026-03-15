import { NextResponse } from 'next/server'
import { fetchStock, fetchBatchStock } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const codes = searchParams.get('codes')

    if (codes) {
      const data = await fetchBatchStock(codes.split(','))
      return NextResponse.json(data)
    }

    if (code) {
      const data = await fetchStock(code)
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: 'code or codes parameter required' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch stock' },
      { status: 500 }
    )
  }
}
