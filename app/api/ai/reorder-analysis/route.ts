import { initializeSecrets } from '@/lib/aws-secrets'
import { streamReorderAnalysis } from '@/lib/services/ai-insights-service'
import { getReorderRecommendations } from '@/lib/services/analytics-service'

export async function GET() {
  try {
    await initializeSecrets()
    const items = await getReorderRecommendations()
    const result = streamReorderAnalysis(items.slice(0, 30))
    return result.toTextStreamResponse()
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
