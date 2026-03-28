import { NextRequest, NextResponse } from 'next/server'
import { fetchItemHistory } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })
  try {
    await initializeSecrets()
    const history = await fetchItemHistory(code)
    return NextResponse.json(history)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch history' },
      { status: 500 }
    )
  }
}
