import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocuments, fetchDocumentDetail, fetchItemDetail } from '@/lib/finansit-client'
import { query } from '@/lib/db'
import { DOC_FORMATS } from '@/lib/constants'

function getSeason(month: number): 'summer' | 'winter' {
  return [5, 6, 7, 8, 9, 10].includes(month) ? 'summer' : 'winter'
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode') || 'incremental'

  try {
    await initializeSecrets()

    // Step 1: Fetch recent invoices with line items
    const invoices = await fetchDocuments(DOC_FORMATS.TAX_INVOICE, mode === 'full' ? 5000 : 1000)

    // Step 2: Fetch line items from invoices (batches of 20)
    const monthlyData = new Map<string, { qty: number; revenue: number; count: number; itemName: string }>()
    let processedDocs = 0

    for (let i = 0; i < invoices.length; i += 20) {
      const batch = invoices.slice(i, i + 20)
      const details = await Promise.all(
        batch.map(async (doc: any) => {
          try { return await fetchDocumentDetail(11, doc.doc_number) } catch { return null }
        })
      )

      for (const detail of details) {
        if (!detail?.lines || !detail.doc_date) continue
        processedDocs++
        const year = parseInt(detail.doc_date.substring(0, 4), 10)
        const month = parseInt(detail.doc_date.substring(5, 7), 10)

        for (const line of detail.lines) {
          if (!line.item_code || line.item_code.length <= 1) continue
          const key = `${year}|${month}|${line.item_code}`
          const existing = monthlyData.get(key) || { qty: 0, revenue: 0, count: 0, itemName: line.item_name || '' }
          existing.qty += line.quantity || 0
          existing.revenue += line.line_total || 0
          existing.count += 1
          if (line.item_name && !existing.itemName) existing.itemName = line.item_name
          monthlyData.set(key, existing)
        }
      }
    }

    // Step 3: Upsert into dashboard.monthly_sales
    let upserted = 0
    for (const [key, data] of monthlyData) {
      // Key format: "YYYY|MM|ITEM_CODE" (pipe-delimited to avoid splitting item codes with dashes)
      const parts = key.split('|')
      const year = parseInt(parts[0], 10)
      const month = parseInt(parts[1], 10)
      const itemCode = parts[2]

      await query(
        `INSERT INTO dashboard.monthly_sales (year, month, item_code, item_name, quantity, revenue, invoice_count, season)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (year, month, item_code) DO UPDATE SET
           item_name = EXCLUDED.item_name,
           quantity = EXCLUDED.quantity,
           revenue = EXCLUDED.revenue,
           invoice_count = EXCLUDED.invoice_count,
           season = EXCLUDED.season`,
        [year, month, itemCode, data.itemName, data.qty, data.revenue, data.count, getSeason(month)]
      )
      upserted++
    }

    // Step 4: Snapshot active items
    const activeItems = new Set<string>()
    for (const key of monthlyData.keys()) {
      activeItems.add(key.split('|')[2])
    }

    let snapshotted = 0
    const itemCodes = [...activeItems].slice(0, 100)
    for (let i = 0; i < itemCodes.length; i += 20) {
      const batch = itemCodes.slice(i, i + 20)
      const results = await Promise.all(
        batch.map(async (code) => {
          try { return await fetchItemDetail(code) } catch { return null }
        })
      )
      for (const item of results) {
        if (!item?.code) continue
        await query(
          `INSERT INTO dashboard.item_snapshots (item_code, item_name, stock_qty, price, sold_this_year, sold_last_year, inquiry_count, category, snapshot_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
           ON CONFLICT (item_code, snapshot_date) DO UPDATE SET
             item_name = EXCLUDED.item_name, stock_qty = EXCLUDED.stock_qty, price = EXCLUDED.price,
             sold_this_year = EXCLUDED.sold_this_year, sold_last_year = EXCLUDED.sold_last_year,
             inquiry_count = EXCLUDED.inquiry_count, category = EXCLUDED.category`,
          [item.code, item.name, item.stock_qty || 0, item.price_list_price || item.price || 0,
           item.sold_this_year || 0, item.sold_last_year || 0, item.inquiry_count || 0, item.group || '']
        )
        snapshotted++
      }
    }

    return NextResponse.json({
      status: 'synced',
      invoices_processed: processedDocs,
      monthly_records: upserted,
      items_snapshotted: snapshotted,
    })
  } catch (error) {
    console.error('[Sync] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
