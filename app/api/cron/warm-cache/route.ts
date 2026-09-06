import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { searchDocuments, fetchDocumentDetail, fetchDocuments, fetchDocumentDetailsByNumber } from '@/lib/finansit-client'
import { deleteCache } from '@/lib/redis-client'
import { getIcsStats } from '@/lib/ics-stats'
import { query, getDb } from '@/lib/db'
import { monthlySales, dailySales } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { syncDailySalesRange, recentWindow } from '@/lib/services/daily-sales-sync'
import { DOC_FORMATS, CACHE_VERSIONS } from '@/lib/constants'
import {
  getItems,
  getDemandAnalysis,
  getSalesData,
  getSeasonalData,
  getDeadStock,
  getReorderRecommendations,
  getTopSellingItems,
  getConversionAnalysis,
  getABCClassification,
  getCustomerAnalytics,
  getDashboardData,
} from '@/lib/services/analytics-service'

function getSeason(month: number): 'summer' | 'winter' {
  return [5, 6, 7, 8, 9, 10].includes(month) ? 'summer' : 'winter'
}

async function ensureTables() {
  await query(`CREATE SCHEMA IF NOT EXISTS dashboard`)
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard.monthly_sales (
      year INT NOT NULL, month INT NOT NULL, item_code TEXT NOT NULL,
      item_name TEXT, quantity NUMERIC DEFAULT 0, revenue NUMERIC DEFAULT 0,
      invoice_count INT DEFAULT 0, season TEXT,
      PRIMARY KEY (year, month, item_code)
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard.daily_sales (
      date DATE NOT NULL, revenue NUMERIC DEFAULT 0, invoice_count INT DEFAULT 0,
      PRIMARY KEY (date)
    )
  `)
}

// In-memory state for tracking warm status
let warmState: {
  running: boolean
  lastRun: string | null
  lastResult: Record<string, unknown> | null
  lastError: string | null
} = { running: false, lastRun: null, lastResult: null, lastError: null }

async function runWarmCache(mode: string, from?: number, to?: number) {
  const totalStart = Date.now()
  const timing: Record<string, number> = {}
  const results: Record<string, unknown> = {}

  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now()
    const result = await fn()
    timing[label] = Date.now() - start
    console.log(`[warm-cache] ${label}: ${timing[label]}ms`)
    return result
  }

  try {
    if (mode === 'historical') {
      await ensureTables()
      const db = await getDb()
      const items = await timed('getItems', getItems)
      const chainMap = new Map<string, string>()
      for (const item of items) {
        if (item.alias_codes) {
          for (const alias of item.alias_codes) chainMap.set(alias, item.code)
        }
      }

      const now = new Date()
      let totalUpserted = 0
      const startPage = from || 1
      const endPage = to || 24

      for (let page = startPage; page <= endPage; page++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - (page - 1), 1)
        const dateFrom = targetDate.toISOString().split('T')[0]
        const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0)
        const dateTo = lastDay.toISOString().split('T')[0]
        const targetYear = String(targetDate.getFullYear())
        const activeYear = String(now.getFullYear())
        const searchP: Record<string, string> = {
          format: String(DOC_FORMATS.TAX_INVOICE), date_from: dateFrom, date_to: dateTo,
          limit: '10000', direction: 'desc',
        }
        if (targetYear !== activeYear) searchP.year = targetYear

        try {
          const invoices = await searchDocuments(searchP)
          if (invoices.length === 0) continue

          // daily_sales upsert via Drizzle
          const dailyMap = new Map<string, { revenue: number; count: number }>()
          for (const inv of invoices) {
            const d = inv.doc_date
            if (!d) continue
            const dateKey = d.split('T')[0]
            const existing = dailyMap.get(dateKey) || { revenue: 0, count: 0 }
            existing.revenue += inv.grand_total || inv.total || 0
            existing.count += 1
            dailyMap.set(dateKey, existing)
          }
          const dailyEntries = [...dailyMap.entries()]
          for (let i = 0; i < dailyEntries.length; i += 50) {
            const batch = dailyEntries.slice(i, i + 50)
            await db.insert(dailySales)
              .values(batch.map(([date, data]) => ({
                date,
                revenue: String(data.revenue),
                invoiceCount: data.count,
              })))
              .onConflictDoUpdate({
                target: dailySales.date,
                set: {
                  revenue: sql`excluded.revenue`,
                  invoiceCount: sql`excluded.invoice_count`,
                },
              })
          }

          // monthly_sales from line items via Drizzle
          const monthlyData = new Map<string, { qty: number; revenue: number; count: number; itemName: string }>()
          {
            // One bulk read of the same invoices, instead of one call each.
            const details = await fetchDocumentDetailsByNumber(11, invoices.map((d: any) => d.doc_number))
            for (const detail of details) {
              if (!detail?.lines || !detail.doc_date) continue
              const year = parseInt(detail.doc_date.substring(0, 4), 10)
              const month = parseInt(detail.doc_date.substring(5, 7), 10)
              for (const line of detail.lines) {
                if (!line.item_code || line.item_code.length <= 1) continue
                const resolvedCode = chainMap.get(line.item_code) || line.item_code
                const key = `${year}|${month}|${resolvedCode}`
                const existing = monthlyData.get(key) || { qty: 0, revenue: 0, count: 0, itemName: line.item_name || '' }
                existing.qty += line.quantity || 0
                existing.revenue += line.line_total || 0
                existing.count += 1
                if (line.item_name && !existing.itemName) existing.itemName = line.item_name
                monthlyData.set(key, existing)
              }
            }
          }
          for (const [key, data] of monthlyData) {
            const parts = key.split('|')
            await db.insert(monthlySales)
              .values({
                year: parseInt(parts[0], 10),
                month: parseInt(parts[1], 10),
                itemCode: parts[2],
                itemName: data.itemName,
                quantity: String(data.qty),
                revenue: String(data.revenue),
                invoiceCount: data.count,
                season: getSeason(parseInt(parts[1], 10)),
              })
              .onConflictDoUpdate({
                target: [monthlySales.year, monthlySales.month, monthlySales.itemCode],
                set: {
                  itemName: sql`excluded.item_name`,
                  quantity: sql`excluded.quantity`,
                  revenue: sql`excluded.revenue`,
                  invoiceCount: sql`excluded.invoice_count`,
                  season: sql`excluded.season`,
                },
              })
            totalUpserted++
          }
          const monthLabel = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`
          console.log(`[warm-cache] Historical ${monthLabel}: ${invoices.length} invoices, ${monthlyData.size} monthly records`)
        } catch (err) {
          console.warn(`[warm-cache] Historical page ${page} failed:`, err)
        }
      }

      warmState.lastResult = { status: 'ok', mode: 'historical', totalMs: Date.now() - totalStart, pagesProcessed: `${startPage}-${endPage}`, recordsUpserted: totalUpserted }
      return
    }

    // Default warm mode: clear items cache, then warm all analytics
    await deleteCache(CACHE_VERSIONS.ITEMS_ENRICHED)
    await ensureTables()
    const db = await getDb()

    const items = await timed('getItems', getItems)
    results['items'] = items.length

    // Build chain map
    const chainMap = new Map<string, string>()
    for (const item of items) {
      if (item.alias_codes) {
        for (const alias of item.alias_codes) chainMap.set(alias, item.code)
      }
    }

    // Always sync daily_sales from recent invoices (fast — headers only, no line items).
    // Date-bounded, not newest-N: see lib/services/daily-sales-sync.ts for why a
    // count-bounded window silently hollowed out whole months.
    await timed('daily-sales-sync', async () => {
      const { dateFrom, dateTo } = recentWindow()
      const res = await syncDailySalesRange(dateFrom, dateTo)
      results['daily_sales_synced'] = res.days
      if (res.rejected.length) results['daily_sales_rejected'] = res.rejected.length
    })

    // Monthly sales line-item sync only in full mode (slower — requires fetching line items)
    if (mode === 'full') {
      await timed('monthly-sales-sync', async () => {
        const invoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 1000)

        // monthly_sales from line items via Drizzle
        const monthlyData = new Map<string, { qty: number; revenue: number; count: number; itemName: string }>()
        {
          // Full mode: 1,000 invoices in one bulk read rather than 1,000 calls.
          const details = await fetchDocumentDetailsByNumber(11, invoices.map((d: any) => d.doc_number))
          for (const detail of details) {
            if (!detail?.lines || !detail.doc_date) continue
            const year = parseInt(detail.doc_date.substring(0, 4), 10)
            const month = parseInt(detail.doc_date.substring(5, 7), 10)
            for (const line of detail.lines) {
              if (!line.item_code || line.item_code.length <= 1) continue
              const resolvedCode = chainMap.get(line.item_code) || line.item_code
              const key = `${year}|${month}|${resolvedCode}`
              const existing = monthlyData.get(key) || { qty: 0, revenue: 0, count: 0, itemName: line.item_name || '' }
              existing.qty += line.quantity || 0
              existing.revenue += line.line_total || 0
              existing.count += 1
              if (line.item_name && !existing.itemName) existing.itemName = line.item_name
              monthlyData.set(key, existing)
            }
          }
        }
        for (const [key, data] of monthlyData) {
          const parts = key.split('|')
          await db.insert(monthlySales)
            .values({
              year: parseInt(parts[0], 10),
              month: parseInt(parts[1], 10),
              itemCode: parts[2],
              itemName: data.itemName,
              quantity: String(data.qty),
              revenue: String(data.revenue),
              invoiceCount: data.count,
              season: getSeason(parseInt(parts[1], 10)),
            })
            .onConflictDoUpdate({
              target: [monthlySales.year, monthlySales.month, monthlySales.itemCode],
              set: {
                itemName: sql`excluded.item_name`,
                quantity: sql`excluded.quantity`,
                revenue: sql`excluded.revenue`,
                invoiceCount: sql`excluded.invoice_count`,
                season: sql`excluded.season`,
              },
            })
        }
        return { invoices: invoices.length, monthly: monthlyData.size }
      })
    }

    // Warm all analytics caches
    const now = new Date()

    /* WARM THE KEY THE BROWSERS WILL ACTUALLY ASK FOR.
     *
     * These keys are `analytics:demand:<from>:<to>`, and the overview page builds
     * `<to>` from `formatDate(new Date(), 'iso')` — which uses getDate/getMonth,
     * i.e. the reader's LOCAL date. This ran in the container, in UTC. Israel is
     * UTC+2/+3, so between midnight and 3am local the browser asks for tomorrow's
     * date while the warmer stored yesterday's: a guaranteed miss, and a miss on
     * this key is the two-minute cold path on the first screen of the app.
     *
     * Everyone using this dashboard is in Israel, so the warmer computes the date
     * the way its readers do rather than the way its server clock does. */
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    // Same clock as `today`, or the first of January repeats the identical bug.
    const yearStart = `${today.slice(0, 4)}-01-01`
    const twoYearsAgo = `${Number(today.slice(0, 4)) - 2}-01-01`

    // Every step recomputes and re-SETs its key (forceRefresh) so the Redis TTL
    // restarts on each warm. Warming through the cache-hit path would leave the
    // original TTL counting down and let expiry land between warm runs, giving
    // users the cold path mid-day.
    const warmSteps: [string, () => Promise<unknown>][] = [
      ['getDashboardData', () => getDashboardData(true)],
      ['getDemandAnalysis', () => getDemandAnalysis(yearStart, today, true)],
      ['getSalesData-ytd', () => getSalesData('ytd')],
      ['getSeasonalData', () => getSeasonalData(twoYearsAgo, today, true)],
      ['getDeadStock-1y', () => getDeadStock(1, true)],
      ['getDeadStock-2y', () => getDeadStock(2, true)],
      ['getDeadStock-3y', () => getDeadStock(3, true)],
      ['getReorderRecommendations', () => getReorderRecommendations(undefined, undefined, true)],
      ['getTopSellingItems-90d', () => getTopSellingItems('90d', true)],
      ['getConversionAnalysis', () => getConversionAnalysis(yearStart, today, true)],
      ['getABCClassification', () => getABCClassification(undefined, undefined, true)],
      ['getCustomerAnalytics', () => getCustomerAnalytics(yearStart, today, true)],
      // Gap analysis lives in its own route (needs per-item FINAPI stock
      // verification) — warm it via a local self-fetch so /gap is never cold.
      ['gapAnalysis', () =>
        fetch(`http://127.0.0.1:${process.env.PORT || '3000'}/api/analytics/gap?refresh=1`)
          .then(r => r.json())],
      // Receivables pulls a live balance per customer (~3.5 min cold) and its
      // 1h TTL expires between warm runs, so users were hitting the cold path.
      // Warm it here; the route also serves stale-while-revalidate as a net.
      ['receivables', () =>
        fetch(`http://127.0.0.1:${process.env.PORT || '3000'}/api/analytics/receivables?refresh=1`)
          .then(r => r.json())],
      // Stock-forecast's default view (200 rows, no filters) — the page's
      // landing request. Other param combos stay demand-computed (seconds).
      ['stockForecast', () =>
        fetch(`http://127.0.0.1:${process.env.PORT || '3000'}/api/analytics/stock-forecast?limit=200&refresh=1`)
          .then(r => r.json())],
      // Vehicle registrations: one ~10s scan of 3.78M rows behind a 24h key.
      // The overview page's Vehicle Market tile reads this cache WITHOUT
      // computing it, so if this step stops running that tile silently shows 0.
      ['icsStats', () => getIcsStats(true)],
    ]

    for (const [label, fn] of warmSteps) {
      try {
        await timed(label, fn)
      } catch (err) {
        console.error(`[warm-cache] ${label} failed:`, err)
        timing[label] = -1
        results[`${label}_error`] = err instanceof Error ? err.message : String(err)
      }
    }

    warmState.lastResult = { status: 'ok', mode, totalMs: Date.now() - totalStart, timing, results }
  } catch (error) {
    console.error('[warm-cache] Failed:', error)
    warmState.lastError = error instanceof Error ? error.message : String(error)
    warmState.lastResult = { status: 'error', error: warmState.lastError, totalMs: Date.now() - totalStart }
  } finally {
    warmState.running = false
    warmState.lastRun = new Date().toISOString()
    console.log(`[warm-cache] Complete. Total: ${Date.now() - totalStart}ms`)
  }
}

async function handleRequest(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') || 'warm'

  // Auth check
  await initializeSecrets()
  const cronSecret = getSecret('CRON_SECRET')
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Status check
  if (mode === 'status') {
    return NextResponse.json(warmState)
  }

  // Don't start if already running
  if (warmState.running) {
    return NextResponse.json({ status: 'already_running', startedAt: warmState.lastRun })
  }

  // Start warming in background — return immediately
  warmState.running = true
  warmState.lastRun = new Date().toISOString()
  warmState.lastError = null

  const from = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined
  const to = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined

  // Fire and forget — don't await
  runWarmCache(mode, from, to).catch(err => {
    console.error('[warm-cache] Unhandled error:', err)
    warmState.running = false
    warmState.lastError = err instanceof Error ? err.message : String(err)
  })

  return NextResponse.json({
    status: 'started',
    mode,
    message: 'Cache warming started in background. Check ?mode=status for progress.',
  })
}

export async function POST(request: Request) {
  return handleRequest(request)
}

export async function GET(request: Request) {
  return handleRequest(request)
}
