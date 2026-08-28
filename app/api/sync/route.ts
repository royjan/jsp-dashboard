import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocumentDetail, fetchDocumentDetailsByNumber, searchDocuments, refreshCache, waitForStockCache, fetchAllStockItemsBlocking } from '@/lib/finansit-client'
import { query, getDb } from '@/lib/db'
import { monthlySales, itemSnapshots, documents } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { DOC_FORMATS, CACHE_VERSIONS } from '@/lib/constants'
import { getItems } from '@/lib/services/analytics-service'
import { deleteCache } from '@/lib/redis-client'
import { fixRtlItemName } from '@/lib/rtl-fix'
import { recentWindow, writeDailySalesFromInvoices } from '@/lib/services/daily-sales-sync'

function getSeason(month: number): 'summer' | 'winter' {
  return [5, 6, 7, 8, 9, 10].includes(month) ? 'summer' : 'winter'
}

async function ensureTables() {
  await query(`CREATE SCHEMA IF NOT EXISTS dashboard`)

  await query(`
    CREATE TABLE IF NOT EXISTS dashboard.monthly_sales (
      year INT NOT NULL,
      month INT NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT,
      quantity NUMERIC DEFAULT 0,
      revenue NUMERIC DEFAULT 0,
      invoice_count INT DEFAULT 0,
      season TEXT,
      PRIMARY KEY (year, month, item_code)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS dashboard.daily_sales (
      date DATE NOT NULL,
      revenue NUMERIC DEFAULT 0,
      invoice_count INT DEFAULT 0,
      PRIMARY KEY (date)
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS dashboard.item_snapshots (
      item_code TEXT NOT NULL,
      item_name TEXT,
      stock_qty NUMERIC DEFAULT 0,
      price NUMERIC DEFAULT 0,
      sold_this_year NUMERIC DEFAULT 0,
      sold_last_year NUMERIC DEFAULT 0,
      inquiry_count NUMERIC DEFAULT 0,
      category TEXT,
      snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
      sale_date TEXT,
      purchase_date TEXT,
      update_date TEXT,
      count_date TEXT,
      PRIMARY KEY (item_code, snapshot_date)
    )
  `)

  await query(`CREATE INDEX IF NOT EXISTS idx_monthly_sales_year_month ON dashboard.monthly_sales (year, month)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_documents_format_date ON dashboard.documents (format, doc_date)`)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_documents_customer_date
    ON dashboard.documents (customer_code, doc_date)
    WHERE format = '11'
  `)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode') || 'incremental'
  const page = parseInt(searchParams.get('page') || '1', 10)
  const PAGE_SIZE = 1000

  try {
    await initializeSecrets()

    // Refresh mode: trigger FINAPI cache rebuild and return
    if (mode === 'refresh') {
      await refreshCache()
      return NextResponse.json({ status: 'refreshed', message: 'FINAPI cache refresh triggered' })
    }

    // Backfill-docs mode: aggregate daily_sales from dashboard.documents (full history from 2020)
    //
    // Two things this has to get right, both of which it used to get wrong:
    //
    // 1. DEDUPE. `documents` archives each invoice once per Btrieve fiscal-year
    //    database it was read from, so a document open across a year-end is
    //    stored twice under two `year` values. Summing the raw table inflated
    //    2023 to 21.7M against a true 18.1M and 2024 to 20.1M against 16.8M —
    //    and that inflated 2024 is what /brief compared 2025 against.
    // 2. CLOSED YEARS ONLY. The archive is authoritative for years that have
    //    finished loading; the active year is FINAPI's (the loader has been
    //    stopped since 2026-05-13, and 2,099 of the 7,147 archived 2026 rows
    //    carry grand_total = 0). Restating the current year from here would
    //    replace good FINAPI figures with a half-loaded, part-zero copy.
    if (mode === 'backfill-docs') {
      await ensureTables()
      // Complex cross-table INSERT...SELECT with ON CONFLICT -- keep as raw SQL
      await query(`
        INSERT INTO dashboard.daily_sales (date, revenue, invoice_count)
        SELECT doc_date, SUM(grand_total), COUNT(*)
        FROM (
          SELECT DISTINCT ON (doc_number) doc_date, grand_total
          FROM dashboard.documents
          WHERE format = '11'
            AND doc_date IS NOT NULL
            AND doc_date < DATE_TRUNC('year', CURRENT_DATE)
          ORDER BY doc_number, year DESC
        ) d
        GROUP BY doc_date
        ON CONFLICT (date) DO UPDATE SET
          revenue = EXCLUDED.revenue,
          invoice_count = EXCLUDED.invoice_count
      `)
      const countResult = await query(`SELECT COUNT(*), MIN(date), MAX(date) FROM dashboard.daily_sales`)
      const row = countResult.rows[0]
      return NextResponse.json({
        status: 'backfilled',
        message: 'daily_sales populated from dashboard.documents',
        rows: row.count,
        min_date: row.min,
        max_date: row.max,
      })
    }

    // Refresh-poll mode: trigger stock rebuild, poll until ready (up to 3 min), clear items cache
    if (mode === 'refresh-poll') {
      const items = await fetchAllStockItemsBlocking(180000)
      const ready = items.length > 0
      if (ready) {
        await deleteCache(CACHE_VERSIONS.ITEMS_ENRICHED)
      }
      return NextResponse.json({
        status: ready ? 'refreshed' : 'timeout',
        message: ready
          ? `FINAPI stock cache rebuilt (${items.length} items), items cache cleared`
          : 'Stock cache rebuild timed out — try again in a minute',
      })
    }

    await ensureTables()
    const db = await getDb()

    // Step 0: Build chain map from items for code resolution
    const chainMap = new Map<string, string>()
    try {
      const items = await getItems()
      for (const item of items) {
        if (item.alias_codes) {
          for (const alias of item.alias_codes) {
            chainMap.set(alias, item.code)
          }
        }
      }
    } catch (e) {
      console.warn('[Sync] Chain map build failed, proceeding without resolution:', e)
    }

    // Step 1: Fetch invoices
    // historical = paginated (PAGE_SIZE per page), full = 5000, incremental = 1000
    let invoices: any[]
    let totalFetched = 0
    let hasMore = false
    // Set when historical mode targets a prior year — threaded into the Step 3
    // line-item detail fetch below, which otherwise defaults to the current
    // year's Btrieve context and hangs/fails for every doc in that month.
    let detailYear: string | undefined
    // The window Step 2 is allowed to restate. Every path below is date-bounded,
    // so the window is always known and always fetched in full.
    let windowFrom: string
    let windowTo: string

    if (mode === 'historical') {
      // page=1 → current month, page=2 → previous month, etc.
      const now = new Date()
      const targetDate = new Date(now.getFullYear(), now.getMonth() - (page - 1), 1)
      const dateFrom = targetDate.toISOString().split('T')[0]
      const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0)
      const dateTo = lastDay.toISOString().split('T')[0]
      windowFrom = dateFrom
      windowTo = dateTo
      const targetYear = String(targetDate.getFullYear())
      const activeYear = String(now.getFullYear())

      const searchParams: Record<string, string> = {
        format: String(DOC_FORMATS.TAX_INVOICE),
        date_from: dateFrom,
        date_to: dateTo,
        limit: '10000',
        direction: 'desc',
      }

      // Query the correct year database when target month is in a previous year
      if (targetYear !== activeYear) {
        searchParams.year = targetYear
        detailYear = targetYear
      }
      invoices = await searchDocuments(searchParams)
      totalFetched = invoices.length
      // has_more is informational — client controls how many pages to fetch
      hasMore = invoices.length > 0
      const monthLabel = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`
      console.log(`[Sync] Historical page ${page} (${monthLabel}): ${invoices.length} invoices for ${dateFrom} to ${dateTo}${targetYear !== activeYear ? ` (year=${targetYear})` : ''}`)
    } else {
      // Date-bounded rather than newest-N. Step 2 below REPLACES each day's total,
      // which is only correct if the window covers those days in full — a
      // count-bounded window never does at its far edge, and that is what
      // hollowed out July 2026 (316 invoices recorded against ~1,600 real).
      // See lib/services/daily-sales-sync.ts.
      const windowDays = mode === 'full' ? 90 : 21
      const { dateFrom, dateTo } = recentWindow(windowDays)
      windowFrom = dateFrom
      windowTo = dateTo
      invoices = await searchDocuments({
        format: String(DOC_FORMATS.TAX_INVOICE),
        date_from: dateFrom,
        date_to: dateTo,
        limit: '10000',
        direction: 'desc',
      })
      console.log(`[Sync] ${mode}: ${invoices.length} invoices for ${dateFrom}..${dateTo}`)
    }

    // Step 2: Populate daily_sales from invoice headers (no line items needed = fast).
    // Shared with the cron so there is one implementation of "replace a day's
    // total only when the day was fetched whole" — see lib/services/daily-sales-sync.ts.
    const dailyResult = await writeDailySalesFromInvoices(invoices, windowFrom, windowTo)
    const dailyUpserted = dailyResult.days

    // Step 3: Fetch line items from invoices for monthly_sales (batches of 20)
    // historical mode processes one month at a time so line-item fetching is manageable
    const lineItemInvoices = invoices
    const monthlyData = new Map<string, { qty: number; revenue: number; count: number; itemName: string }>()
    let processedDocs = 0

    {
      // Bulk read where the box + year allow it; the helper falls back to
      // per-document reads for a historical year (the feed is active-year only).
      const details = await fetchDocumentDetailsByNumber(11, lineItemInvoices.map((d: any) => d.doc_number), detailYear)

      for (const detail of details) {
        if (!detail?.lines || !detail.doc_date) continue
        processedDocs++
        const year = parseInt(detail.doc_date.substring(0, 4), 10)
        const month = parseInt(detail.doc_date.substring(5, 7), 10)

        for (const line of detail.lines) {
          if (!line.item_code || line.item_code.length <= 1) continue
          const resolvedCode = chainMap.get(line.item_code) || line.item_code
          const key = `${year}|${month}|${resolvedCode}`
          const existing = monthlyData.get(key) || { qty: 0, revenue: 0, count: 0, itemName: fixRtlItemName(line.item_name || '') }
          existing.qty += line.quantity || 0
          existing.revenue += line.line_total || 0
          existing.count += 1
          if (line.item_name && !existing.itemName) existing.itemName = line.item_name
          monthlyData.set(key, existing)
        }
      }
    }

    // Step 4: Upsert into dashboard.monthly_sales
    let monthlyUpserted = 0
    for (const [key, data] of monthlyData) {
      const parts = key.split('|')
      const year = parseInt(parts[0], 10)
      const month = parseInt(parts[1], 10)
      const itemCode = parts[2]

      await db.insert(monthlySales)
        .values({
          year,
          month,
          itemCode,
          itemName: data.itemName,
          quantity: String(data.qty),
          revenue: String(data.revenue),
          invoiceCount: data.count,
          season: getSeason(month),
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
      monthlyUpserted++
    }

    // Step 5: Snapshot active items using enriched data from getItems()
    // getItems() reads from FINAPI Redis which has sale_date, purchase_date etc.
    // fetchItemDetail() HTTP API does NOT return dates for most items.
    let snapshotted = 0
    if (mode !== 'historical') {
      const allItems = await getItems()
      const itemMap = new Map(allItems.map(item => [item.code, item]))

      const activeItems = new Set<string>()
      for (const key of monthlyData.keys()) {
        activeItems.add(key.split('|')[2])
      }

      for (const code of activeItems) {
        const item = itemMap.get(code)
        if (!item) continue
        await db.insert(itemSnapshots)
          .values({
            itemCode: item.code,
            itemName: fixRtlItemName(item.name),
            stockQty: String(item.stock_qty || 0),
            price: String(item.price || 0),
            soldThisYear: String(item.sold_this_year || 0),
            soldLastYear: String(item.sold_last_year || 0),
            inquiryCount: String(item.inquiry_count || 0),
            category: item.category || '',
            snapshotDate: sql`CURRENT_DATE`,
            saleDate: item.sale_date || null,
            purchaseDate: item.purchase_date || null,
            updateDate: item.update_date || null,
            countDate: item.count_date || null,
          })
          .onConflictDoUpdate({
            target: [itemSnapshots.itemCode, itemSnapshots.snapshotDate],
            set: {
              itemName: sql`excluded.item_name`,
              stockQty: sql`excluded.stock_qty`,
              price: sql`excluded.price`,
              soldThisYear: sql`excluded.sold_this_year`,
              soldLastYear: sql`excluded.sold_last_year`,
              inquiryCount: sql`excluded.inquiry_count`,
              category: sql`excluded.category`,
              saleDate: sql`excluded.sale_date`,
              purchaseDate: sql`excluded.purchase_date`,
              updateDate: sql`excluded.update_date`,
              countDate: sql`excluded.count_date`,
            },
          })
        snapshotted++
      }
    }

    const response: any = {
      status: 'synced',
      mode,
      invoices_fetched: invoices.length,
      daily_sales_upserted: dailyUpserted,
      daily_sales_window: `${dailyResult.from}..${dailyResult.to}`,
      daily_sales_rejected: dailyResult.rejected.length ? dailyResult.rejected : undefined,
      invoices_with_lines: processedDocs,
      monthly_records: monthlyUpserted,
      items_snapshotted: snapshotted,
    }

    if (mode === 'historical') {
      const now = new Date()
      const targetDate = new Date(now.getFullYear(), now.getMonth() - (page - 1), 1)
      const monthLabel = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`
      response.page = page
      response.month_range = monthLabel
      response.has_more = hasMore
      if (hasMore) {
        response.next_page = page + 1
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Sync] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
