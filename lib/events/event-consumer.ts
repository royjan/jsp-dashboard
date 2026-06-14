/**
 * SQS-based event consumer for the Jan Parts dashboard.
 *
 * Uses the SDK's EventListener to poll an SQS queue subscribed to the
 * jan-parts-events SNS topic. On event receipt, invalidates relevant
 * Redis cache keys so dashboard data stays fresh.
 *
 * This is an alternative to the webhook approach (app/api/events/webhook).
 * Use the webhook for serverless deployments (App Runner, Vercel) and
 * the SQS consumer for long-running server processes.
 *
 * Usage:
 * ```ts
 * import { startEventConsumer, stopEventConsumer } from '@/lib/events/event-consumer'
 *
 * // Start consuming events (call once at server startup)
 * await startEventConsumer()
 *
 * // Stop consuming events (call at shutdown)
 * stopEventConsumer()
 * ```
 */

import { EventListener } from '@jan/finansit-sdk'
import type { JanEvent } from '@jan/finansit-sdk'
import { deleteCache } from '@/lib/redis-client'

// Redis cache key prefixes (mirrors webhook route)
const CACHE_KEYS = {
  dashboard: 'dashboard:kpi',
  items: 'dashboard:items',
  stock: 'dashboard:stock',
  documents: 'dashboard:documents',
  customers: 'dashboard:customers',
  seasonal: 'dashboard:seasonal',
  deadStock: 'dashboard:dead-stock',
  salesData: 'dashboard:sales',
  demandAnalysis: 'dashboard:demand',
  topSelling: 'dashboard:top-selling',
  conversion: 'dashboard:conversion',
  abc: 'dashboard:abc',
  customerAnalytics: 'dashboard:customer-analytics',
  reorder: 'dashboard:reorder',
} as const

let listener: EventListener | null = null

/**
 * Start the SQS event consumer. No-op if SQS_QUEUE_URL is not set
 * or if the consumer is already running.
 */
export async function startEventConsumer(): Promise<void> {
  const queueUrl = process.env.SQS_QUEUE_URL
  if (!queueUrl) {
    console.log('[event-consumer] SQS_QUEUE_URL not set — event consumer disabled, using cron fallback')
    return
  }

  if (listener?.isRunning()) {
    console.log('[event-consumer] Already running')
    return
  }

  listener = new EventListener({
    queueUrl,
    region: process.env.AWS_REGION || 'il-central-1',
    onEvent: (event) => {
      console.log('[event-consumer] Received event:', event.type)
    },
  })

  // Register type-specific handlers
  listener.on('cache.refreshed', async (event: JanEvent) => {
    const data = event.data as { table?: string }
    if (data.table) {
      const tableToKeys: Record<string, string[]> = {
        items: [CACHE_KEYS.items, CACHE_KEYS.topSelling, CACHE_KEYS.abc],
        stock: [CACHE_KEYS.stock, CACHE_KEYS.deadStock, CACHE_KEYS.reorder],
        documents: [CACHE_KEYS.documents, CACHE_KEYS.dashboard, CACHE_KEYS.salesData, CACHE_KEYS.conversion],
        customers: [CACHE_KEYS.customers, CACHE_KEYS.customerAnalytics],
        prices: [CACHE_KEYS.items],
      }
      const keys = tableToKeys[data.table] ?? []
      await Promise.all(keys.map(k => safeDeleteCache(k)))
    } else {
      await invalidateAllCaches()
    }
  })

  listener.on('document.created', async () => {
    await Promise.all([
      safeDeleteCache(CACHE_KEYS.documents),
      safeDeleteCache(CACHE_KEYS.dashboard),
      safeDeleteCache(CACHE_KEYS.salesData),
      safeDeleteCache(CACHE_KEYS.conversion),
      safeDeleteCache(CACHE_KEYS.customerAnalytics),
    ])
  })

  listener.on('document.converted', async () => {
    await Promise.all([
      safeDeleteCache(CACHE_KEYS.documents),
      safeDeleteCache(CACHE_KEYS.dashboard),
      safeDeleteCache(CACHE_KEYS.salesData),
      safeDeleteCache(CACHE_KEYS.conversion),
    ])
  })

  listener.on('stock.changed', async () => {
    await Promise.all([
      safeDeleteCache(CACHE_KEYS.stock),
      safeDeleteCache(CACHE_KEYS.deadStock),
      safeDeleteCache(CACHE_KEYS.reorder),
      safeDeleteCache(CACHE_KEYS.demandAnalysis),
    ])
  })

  listener.on('item.updated', async () => {
    await Promise.all([
      safeDeleteCache(CACHE_KEYS.items),
      safeDeleteCache(CACHE_KEYS.topSelling),
      safeDeleteCache(CACHE_KEYS.abc),
      safeDeleteCache(CACHE_KEYS.seasonal),
    ])
  })

  await listener.start()
  console.log('[event-consumer] Started polling SQS queue:', queueUrl)
}

/**
 * Stop the SQS event consumer.
 */
export function stopEventConsumer(): void {
  if (listener) {
    listener.stop()
    listener = null
    console.log('[event-consumer] Stopped')
  }
}

async function invalidateAllCaches(): Promise<void> {
  await Promise.all(
    Object.values(CACHE_KEYS).map(k => safeDeleteCache(k))
  )
}

async function safeDeleteCache(key: string): Promise<void> {
  try {
    await deleteCache(key)
  } catch (err) {
    console.warn(`[event-consumer] Failed to delete cache key "${key}":`, err)
  }
}
