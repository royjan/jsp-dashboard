import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getGraphData } from '@/lib/chat-admin/word-mappings'

export const dynamic = 'force-dynamic'

/** GET /api/admin/word-mappings/graph?language=&letter= */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const language = searchParams.get('language') as 'en' | 'he' | 'ar' | null
    const letter = searchParams.get('letter') || undefined

    if (!language) {
      return NextResponse.json({ error: 'Missing required parameter: language' }, { status: 400 })
    }
    if (!['en', 'he'].includes(language)) {
      return NextResponse.json({ error: 'Invalid language. Must be "en" or "he"' }, { status: 400 })
    }

    const graphData = await getGraphData(language, letter)
    return NextResponse.json(graphData)
  } catch (error) {
    console.error('Error fetching graph data:', error)
    return NextResponse.json({ error: 'Failed to fetch graph data' }, { status: 500 })
  }
}
