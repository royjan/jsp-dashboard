import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { searchDocuments, fetchDocumentDetail, fetchDocuments } from '@/lib/finansit-client'
import { deleteCache } from '@/lib/redis-client'
import { query } from '@/lib/db'
import { DOC_FORMATS } from '@/lib/constants'
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

          // daily_sales
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
            const values: (string | number)[] = []
            const placeholders: string[] = []
            batch.forEach(([date, data], idx) => {
              const offset = idx * 3
              placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`)
              values.push(date, data.revenue, data.count)
            })
            await query(
              `INSERT INTO dashboard.daily_sales (date, revenue, invoice_count) VALUES ${placeholders.join(', ')}
               ON CONFLICT (date) DO UPDATE SET revenue = EXCLUDED.revenue, invoice_count = EXCLUDED.invoice_count`,
              values
            )
          }

          // monthly_sales from line items
          const monthlyData = new Map<string, { qty: number; revenue: number; count: number; itemName: string }>()
          for (let i = 0; i < invoices.length; i += 20) {
            const batch = invoices.slice(i, i + 20)
            const details = await Promise.all(
              batch.map(async (doc: any) => {
                try { return await fetchDocumentDetail(11, doc.doc_number) } catch { return null }
              })
            )
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
            await query(
              `INSERT INTO dashboard.monthly_sales (year, month, item_code, item_name, quantity, revenue, invoice_count, season)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (year, month, item_code) DO UPDATE SET
                 item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity,
                 revenue = EXCLUDED.revenue, invoice_count = EXCLUDED.invoice_count, season = EXCLUDED.season`,
              [parseInt(parts[0], 10), parseInt(parts[1], 10), parts[2], data.itemName, data.qty, data.revenue, data.count, getSeason(parseInt(parts[1], 10))]
            )
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
    await deleteCache('items:enriched:v9')
    await ensureTables()

    const items = await timed('getItems', getItems)
    results['items'] = items.length

    // Build chain map
    const chainMap = new Map<string, string>()
    for (const item of items) {
      if (item.alias_codes) {
        for (const alias of item.alias_codes) chainMap.set(alias, item.code)
      }
    }

    // Incremental sync in full mode
    if (mode === 'full') {
      await timed('incremental-sync', async () => {
        const invoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, 1000)
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
          const values: (string | number)[] = []
          const placeholders: string[] = []
          batch.forEach(([date, data], idx) => {
            const offset = idx * 3
            placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`)
            values.push(date, data.revenue, data.count)
          })
          await query(
            `INSERT INTO dashboard.daily_sales (date, revenue, invoice_count) VALUES ${placeholders.join(', ')}
             ON CONFLICT (date) DO UPDATE SET revenue = EXCLUDED.revenue, invoice_count = EXCLUDED.invoice_count`,
            values
          )
        }
        const monthlyData = new Map<string, { qty: number; revenue: number; count: number; itemName: string }>()
        for (let i = 0; i < invoices.length; i += 20) {
          const batch = invoices.slice(i, i + 20)
          const details = await Promise.all(
            batch.map(async (doc: any) => {
              try { return await fetchDocumentDetail(11, doc.doc_number) } catch { return null }
            })
          )
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
          await query(
            `INSERT INTO dashboard.monthly_sales (year, month, item_code, item_name, quantity, revenue, invoice_count, season)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (year, month, item_code) DO UPDATE SET
               item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity,
               revenue = EXCLUDED.revenue, invoice_count = EXCLUDED.invoice_count, season = EXCLUDED.season`,
            [parseInt(parts[0], 10), parseInt(parts[1], 10), parts[2], data.itemName, data.qty, data.revenue, data.count, getSeason(parseInt(parts[1], 10))]
          )
        }
        return { invoices: invoices.length, daily: dailyMap.size, monthly: monthlyData.size }
      })
    }

    // Warm all analytics caches
    const now = new Date()
    const yearStart = `${now.getFullYear()}-01-01`
    const today = now.toISOString().split('T')[0]
    const twoYearsAgo = `${now.getFullYear() - 2}-01-01`

    const warmSteps: [string, () => Promise<unknown>][] = [
      ['getDashboardData', getDashboardData],
      ['getDemandAnalysis', () => getDemandAnalysis(yearStart, today)],
      ['getSalesData-ytd', () => getSalesData('ytd')],
      ['getSeasonalData', () => getSeasonalData(twoYearsAgo, today)],
      ['getDeadStock-1y', () => getDeadStock(1)],
      ['getDeadStock-2y', () => getDeadStock(2)],
      ['getDeadStock-3y', () => getDeadStock(3)],
      ['getReorderRecommendations', () => getReorderRecommendations()],
      ['getTopSellingItems-90d', () => getTopSellingItems('90d')],
      ['getConversionAnalysis', () => getConversionAnalysis(yearStart, today)],
      ['getABCClassification', getABCClassification],
      ['getCustomerAnalytics', () => getCustomerAnalytics(yearStart, today)],
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
