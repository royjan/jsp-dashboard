import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { fetchBatchStock, fetchBatchPrices } from '@/lib/finansit-client'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const categoryId = searchParams.get('categoryId')
    const subcategoryId = searchParams.get('subcategoryId')
    const searchQuery = searchParams.get('q')?.trim()

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    // Build query for parts from partly schema
    let sql: string
    let params: any[]

    if (searchQuery) {
      // Search across all parts for this project
      sql = `
        SELECT DISTINCT
          gp.id as global_part_id,
          gp.item_number,
          gp.description,
          gp.hebrew_description,
          pp.scheme_number,
          pp.quantity,
          pp.position,
          s.name as schema_name,
          s.schema_number,
          sc.name as subcategory_name,
          c.name as category_name,
          c.code as category_code
        FROM partly.project_parts pp
        JOIN partly.global_parts gp ON gp.id = pp.global_part_id
        LEFT JOIN partly.schemas s ON s.id = pp.schema_id
        LEFT JOIN partly.subcategories sc ON sc.id = s.subcategory_id
        LEFT JOIN partly.categories c ON c.id = sc.category_id
        WHERE pp.project_id = $1
          AND pp.deleted_at IS NULL
          AND (
            gp.item_number ILIKE $2
            OR gp.description ILIKE $2
            OR gp.hebrew_description ILIKE $2
          )
        ORDER BY c.code, sc.name, s.schema_number
        LIMIT 200
      `
      params = [projectId, `%${searchQuery}%`]
    } else if (subcategoryId) {
      // Parts for a specific subcategory (all schemas under it)
      sql = `
        SELECT DISTINCT
          gp.id as global_part_id,
          gp.item_number,
          gp.description,
          gp.hebrew_description,
          pp.scheme_number,
          pp.quantity,
          pp.position,
          s.name as schema_name,
          s.schema_number,
          sc.name as subcategory_name,
          c.name as category_name,
          c.code as category_code
        FROM partly.project_parts pp
        JOIN partly.global_parts gp ON gp.id = pp.global_part_id
        LEFT JOIN partly.schemas s ON s.id = pp.schema_id
        LEFT JOIN partly.subcategories sc ON sc.id = s.subcategory_id
        LEFT JOIN partly.categories c ON c.id = sc.category_id
        WHERE pp.project_id = $1
          AND pp.deleted_at IS NULL
          AND sc.id = $2
        ORDER BY s.schema_number, pp.scheme_number
        LIMIT 500
      `
      params = [projectId, subcategoryId]
    } else if (categoryId) {
      // Parts for all subcategories under a category
      sql = `
        SELECT DISTINCT
          gp.id as global_part_id,
          gp.item_number,
          gp.description,
          gp.hebrew_description,
          pp.scheme_number,
          pp.quantity,
          pp.position,
          s.name as schema_name,
          s.schema_number,
          sc.name as subcategory_name,
          c.name as category_name,
          c.code as category_code
        FROM partly.project_parts pp
        JOIN partly.global_parts gp ON gp.id = pp.global_part_id
        LEFT JOIN partly.schemas s ON s.id = pp.schema_id
        LEFT JOIN partly.subcategories sc ON sc.id = s.subcategory_id
        LEFT JOIN partly.categories c ON c.id = sc.category_id
        WHERE pp.project_id = $1
          AND pp.deleted_at IS NULL
          AND c.id = $2
        ORDER BY sc.name, s.schema_number, pp.scheme_number
        LIMIT 500
      `
      params = [projectId, categoryId]
    } else {
      return NextResponse.json({ error: 'categoryId, subcategoryId, or q is required' }, { status: 400 })
    }

    const partsResult = await query(sql, params)
    const parts = partsResult.rows

    if (parts.length === 0) {
      return NextResponse.json({ parts: [], stockMap: {}, priceMap: {} })
    }

    // Collect unique item numbers for stock/price lookup
    const itemNumbers = [...new Set(parts.map((p: any) => p.item_number).filter(Boolean))]

    // Lookup stock and prices from Finansit in parallel
    let stockMap: Record<string, any> = {}
    let priceMap: Record<string, number> = {}

    if (itemNumbers.length > 0) {
      try {
        const [stockItems, prices] = await Promise.all([
          fetchBatchStock(itemNumbers as string[]).catch(() => []),
          fetchBatchPrices(itemNumbers as string[]).catch(() => ({})),
        ])

        // Build stock map
        for (const item of stockItems) {
          const code = (item.item_code || item.code || '').toUpperCase()
          if (code) {
            stockMap[code] = {
              stockQty: item.stock_qty ?? item.quantity ?? 0,
              incomingQty: item.incoming_qty ?? 0,
              orderedQty: item.ordered_qty ?? 0,
            }
          }
        }

        priceMap = prices
      } catch (e) {
        console.error('[VIN Catalog] Stock/price lookup error:', e)
      }
    }

    // Enrich parts with stock status
    const enrichedParts = parts.map((p: any) => {
      const code = (p.item_number || '').toUpperCase()
      const stock = stockMap[code]
      const price = priceMap[code]

      let stockStatus: 'in_stock' | 'incoming' | 'out_of_stock' | 'unknown' = 'unknown'
      if (stock) {
        if (stock.stockQty > 0) stockStatus = 'in_stock'
        else if (stock.incomingQty > 0) stockStatus = 'incoming'
        else stockStatus = 'out_of_stock'
      }

      return {
        globalPartId: p.global_part_id,
        itemNumber: p.item_number,
        description: p.description,
        hebrewDescription: p.hebrew_description,
        schemeNumber: p.scheme_number,
        quantity: p.quantity,
        position: p.position,
        schemaName: p.schema_name,
        schemaNumber: p.schema_number,
        subcategoryName: p.subcategory_name,
        categoryName: p.category_name,
        categoryCode: p.category_code,
        stockQty: stock?.stockQty ?? null,
        incomingQty: stock?.incomingQty ?? null,
        orderedQty: stock?.orderedQty ?? null,
        price: price ?? null,
        stockStatus,
      }
    })

    return NextResponse.json({
      parts: enrichedParts,
      total: enrichedParts.length,
    })
  } catch (error) {
    console.error('[VIN Catalog] Parts error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch parts' },
      { status: 500 }
    )
  }
}
