export const maxDuration = 30

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { supplierPriceUploads } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'
import * as XLSX from 'xlsx'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { searchParams } = new URL(request.url)
    const supplierCode = searchParams.get('supplier_code')

    const query = db
      .select()
      .from(supplierPriceUploads)
      .$dynamic()

    if (supplierCode) {
      query.where(eq(supplierPriceUploads.supplierCode, supplierCode))
    }

    query.orderBy(desc(supplierPriceUploads.uploadDate)).limit(50)

    const uploads = await query

    return NextResponse.json({ uploads })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()

    const formData = await request.formData()
    const file = formData.get('file') as File
    const supplierCode = formData.get('supplier_code') as string

    if (!file || !supplierCode) {
      return NextResponse.json(
        { error: 'file and supplier_code are required' },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let parsedRows: any[] = []
    let errors: string[] = []

    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.csv')) {
      // Parse CSV
      const text = buffer.toString('utf-8')
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) {
        return NextResponse.json({ error: 'CSV file is empty or has no data rows' }, { status: 400 })
      }
      const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''))
      for (let i = 1; i < lines.length; i++) {
        try {
          const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''))
          const row: Record<string, string> = {}
          headers.forEach((h, idx) => { row[h] = values[idx] || '' })
          parsedRows.push(row)
        } catch {
          errors.push(`Row ${i + 1}: parse error`)
        }
      }
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Parse Excel
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) {
        return NextResponse.json({ error: 'Excel file has no sheets' }, { status: 400 })
      }
      const sheet = workbook.Sheets[sheetName]
      parsedRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    } else {
      return NextResponse.json(
        { error: 'Unsupported file format. Use CSV or Excel (xlsx).' },
        { status: 400 }
      )
    }

    // Validate rows — expect at least item_code and price columns
    const validRows: any[] = []
    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i]
      // Accept various column name patterns
      const itemCode = row.item_code || row.ItemCode || row.code || row['קוד פריט'] || row.SKU || row.sku || ''
      const price = row.price || row.Price || row['מחיר'] || row.cost || row.Cost || ''

      if (!itemCode) {
        errors.push(`Row ${i + 2}: missing item code`)
        continue
      }
      if (!price || isNaN(Number(price))) {
        errors.push(`Row ${i + 2}: invalid price for ${itemCode}`)
        continue
      }

      validRows.push({
        itemCode: String(itemCode).trim().toUpperCase(),
        price: Number(price),
        description: row.description || row.Description || row['תיאור'] || row.name || row.Name || '',
        currency: row.currency || row.Currency || 'ILS',
        moq: row.moq || row.MOQ || row['מינימום'] || null,
      })
    }

    // Store in DB
    const result = await db
      .insert(supplierPriceUploads)
      .values({
        supplierCode,
        fileName: file.name,
        status: 'completed',
        itemsCount: validRows.length,
        errorsCount: errors.length,
        processedAt: new Date(),
        parsedData: { rows: validRows, errors: errors.slice(0, 50) },
      })
      .returning()

    return NextResponse.json({
      upload: result[0],
      summary: {
        totalRows: parsedRows.length,
        validItems: validRows.length,
        errors: errors.length,
        errorDetails: errors.slice(0, 20),
      },
      preview: validRows.slice(0, 10),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process file' },
      { status: 500 }
    )
  }
}
