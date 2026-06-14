import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ items: [], customers: [], semantic: [] })
  }

  try {
    await initializeSecrets()

    // Determine if query looks like natural language (contains spaces, >3 chars)
    const isNaturalLanguage = q.length > 3 && q.includes(' ')

    const promises: [
      Promise<{ items: any[] }>,
      Promise<{ customers: any[] }>,
      Promise<{ items: any[] }> | null,
    ] = [
      client.items.search(q, 5).catch(() => ({ items: [] })),
      client.customers.search(q, 5).catch(() => ({ customers: [] })),
      isNaturalLanguage
        ? client.items.semanticSearch(q, 5).catch(() => ({ items: [] }))
        : null,
    ]

    const results = await Promise.all(
      promises.filter((p): p is NonNullable<typeof p> => p !== null)
    )

    const itemsResult = results[0] as { items: any[] }
    const customersResult = results[1] as { customers: any[] }
    const semanticResult = isNaturalLanguage
      ? (results[2] as { items: any[] })
      : { items: [] }

    const items = (itemsResult.items || itemsResult || []).slice(0, 5)
    const customers = (customersResult.customers || customersResult || []).slice(0, 5)
    const semantic = (semanticResult.items || []).slice(0, 5)

    return NextResponse.json({ items, customers, semantic })
  } catch (error) {
    console.error('[API /search] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
