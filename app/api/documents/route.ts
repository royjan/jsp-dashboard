import { NextResponse } from 'next/server'
import { fetchDocuments, searchDocuments } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    if (!format) {
      return NextResponse.json({ error: 'format parameter required' }, { status: 400 })
    }

    const cacheKey = `docs:${format}:${dateFrom || ''}:${dateTo || ''}`
    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    let docs
    if (dateFrom || dateTo) {
      const params: Record<string, string> = { format }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      docs = await searchDocuments(params)
    } else {
      docs = await fetchDocuments(Number(format))
    }

    const result = { documents: docs, count: docs.length }
    await setCache(cacheKey, result, CACHE_TTL.DOCUMENTS)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch documents' },
      { status: 500 }
    )
  }
}
