import { NextResponse } from 'next/server'
import { getItems } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET() {
  try {
    await initializeSecrets()
    const items = await getItems()
    return NextResponse.json({ items, count: items.length })
  } catch (error) {
    console.error('[API /items] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch items' },
      { status: 500 }
    )
  }
}
