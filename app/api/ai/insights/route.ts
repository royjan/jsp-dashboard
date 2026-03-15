import { NextRequest, NextResponse } from 'next/server'
import { generateInsights } from '@/lib/services/ai-insights-service'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const refresh = request.nextUrl.searchParams.get('refresh') === 'true'
    const insights = await generateInsights(refresh)
    return NextResponse.json({ insights, count: insights.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate insights' },
      { status: 500 }
    )
  }
}
