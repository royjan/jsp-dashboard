import { initializeSecrets } from '@/lib/aws-secrets'
import { streamStockOptimization } from '@/lib/services/ai-insights-service'
import { getDeadStock } from '@/lib/services/analytics-service'

export async function GET() {
  try {
    await initializeSecrets()
    const deadStock = await getDeadStock(1)
    const result = streamStockOptimization(deadStock.slice(0, 20), {
      total_dead_items: deadStock.length,
      total_capital_tied: deadStock.reduce((s, i) => s + i.capital_tied, 0),
    })
    return result.toTextStreamResponse()
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
