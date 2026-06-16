/**
 * SNS webhook endpoint for receiving Jan Parts event bus notifications.
 *
 * SNS can POST directly to this endpoint (HTTP/HTTPS subscription).
 * Handles both subscription confirmation and event notification messages.
 *
 * On event receipt: invalidates relevant Redis cache keys so the next
 * dashboard request fetches fresh data. Falls back to cron-based cache
 * warming if the event bus is not configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { deleteCache } from '@/lib/redis-client'
import { revalidateTag } from 'next/cache'
// Local event/SNS shapes (was @jan/finansit-sdk — the dashboard no longer depends
// on the SDK; the MCP server still does). Permissive on purpose.
type JanEvent = { type?: string; entity?: string; id?: string; [k: string]: any }
type SnsNotification = { Type?: string; Message: string; [k: string]: any }
type SnsSubscriptionConfirmation = { Type?: string; SubscribeURL: string; [k: string]: any }

// Redis cache key prefixes used by the dashboard (from analytics-service + cron)
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Handle SNS subscription confirmation
    if (body.Type === 'SubscriptionConfirmation') {
      const confirmation = body as SnsSubscriptionConfirmation
      console.log('[events/webhook] Confirming SNS subscription for topic:', confirmation.TopicArn)

      // Fetch the SubscribeURL to confirm the subscription
      try {
        await fetch(confirmation.SubscribeURL)
        console.log('[events/webhook] SNS subscription confirmed')
        return NextResponse.json({ status: 'subscription_confirmed' })
      } catch (err) {
        console.error('[events/webhook] Failed to confirm SNS subscription:', err)
        return NextResponse.json({ error: 'confirmation_failed' }, { status: 500 })
      }
    }

    // Handle SNS notification
    if (body.Type === 'Notification') {
      const notification = body as SnsNotification
      let event: JanEvent

      try {
        event = JSON.parse(notification.Message) as JanEvent
      } catch {
        console.warn('[events/webhook] Failed to parse SNS notification message')
        return NextResponse.json({ error: 'invalid_message' }, { status: 400 })
      }

      console.log('[events/webhook] Received event:', event.type, event.data)
      await handleEvent(event)
      return NextResponse.json({ status: 'processed', event_type: event.type })
    }

    // Direct event format (not wrapped in SNS envelope)
    if (body.type && body.timestamp) {
      const event = body as JanEvent
      console.log('[events/webhook] Received direct event:', event.type, event.data)
      await handleEvent(event)
      return NextResponse.json({ status: 'processed', event_type: event.type })
    }

    return NextResponse.json({ error: 'unknown_message_type' }, { status: 400 })
  } catch (err) {
    console.error('[events/webhook] Error processing event:', err)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

/**
 * Handle a parsed event by invalidating the relevant caches.
 */
async function handleEvent(event: JanEvent): Promise<void> {
  switch (event.type) {
    case 'cache.refreshed':
      await invalidateCacheRefreshed(event.data as { table?: string })
      break

    case 'document.created':
    case 'document.converted':
      await invalidateDocumentCaches()
      break

    case 'stock.changed':
      await invalidateStockCaches()
      break

    case 'item.updated':
      await invalidateItemCaches()
      break

    default:
      console.log('[events/webhook] Unknown event type, invalidating all caches:', event.type)
      await invalidateAllCaches()
  }
}

async function invalidateCacheRefreshed(data: { table?: string }): Promise<void> {
  if (data.table) {
    // Targeted invalidation for specific table
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
    // Full refresh — invalidate everything
    await invalidateAllCaches()
  }

  // Revalidate Next.js cache tags
  safeRevalidateTag('dashboard')
  safeRevalidateTag('analytics')
}

async function invalidateDocumentCaches(): Promise<void> {
  await Promise.all([
    safeDeleteCache(CACHE_KEYS.documents),
    safeDeleteCache(CACHE_KEYS.dashboard),
    safeDeleteCache(CACHE_KEYS.salesData),
    safeDeleteCache(CACHE_KEYS.conversion),
    safeDeleteCache(CACHE_KEYS.customerAnalytics),
  ])
  safeRevalidateTag('dashboard')
  safeRevalidateTag('documents')
}

async function invalidateStockCaches(): Promise<void> {
  await Promise.all([
    safeDeleteCache(CACHE_KEYS.stock),
    safeDeleteCache(CACHE_KEYS.deadStock),
    safeDeleteCache(CACHE_KEYS.reorder),
    safeDeleteCache(CACHE_KEYS.demandAnalysis),
  ])
  safeRevalidateTag('stock')
}

async function invalidateItemCaches(): Promise<void> {
  await Promise.all([
    safeDeleteCache(CACHE_KEYS.items),
    safeDeleteCache(CACHE_KEYS.topSelling),
    safeDeleteCache(CACHE_KEYS.abc),
    safeDeleteCache(CACHE_KEYS.seasonal),
  ])
  safeRevalidateTag('items')
}

async function invalidateAllCaches(): Promise<void> {
  await Promise.all(
    Object.values(CACHE_KEYS).map(k => safeDeleteCache(k))
  )
  safeRevalidateTag('dashboard')
  safeRevalidateTag('analytics')
  safeRevalidateTag('documents')
  safeRevalidateTag('stock')
  safeRevalidateTag('items')
}

async function safeDeleteCache(key: string): Promise<void> {
  try {
    await deleteCache(key)
  } catch (err) {
    console.warn(`[events/webhook] Failed to delete cache key "${key}":`, err)
  }
}

function safeRevalidateTag(tag: string): void {
  try {
    revalidateTag(tag, 'max')
  } catch (err) {
    // revalidateTag may fail outside of a request context in some Next.js versions
    console.warn(`[events/webhook] Failed to revalidate tag "${tag}":`, err)
  }
}
