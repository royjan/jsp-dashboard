export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { supplierProfiles } from '@/lib/db/schema'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

/**
 * Extract unique suppliers from Finansit supplier-related documents
 * and upsert them into the supplierProfiles table.
 *
 * Supplier document formats:
 *  51 = Local supplier invoice (חשבונית מספק בארץ)
 *  58 = Foreign supplier invoice (חשבונית מספק חו"ל)
 *  61 = Supplier order (הזמנה מספק)
 *  62 = In-transit supplier order (הזמנה בדרך מספק)
 */

const SUPPLIER_FORMATS = ['51', '58', '61', '62']

interface RawDoc {
  customer_code: string
  customer_name: string
  grand_total: number
  doc_date: string | null
}

export async function POST() {
  try {
    await initializeSecrets()
    const db = await getDb()

    // Collect unique suppliers from all supplier-related document formats
    const supplierMap = new Map<string, { name: string; type: 'local' | 'foreign'; docCount: number; totalVolume: number; lastDate: string }>()

    for (const format of SUPPLIER_FORMATS) {
      const data = await client.documents.search({
        doc_format: format,
        limit: 500,
      })

      const docs: RawDoc[] = data.documents || []
      for (const doc of docs) {
        const code = doc.customer_code
        if (!code) continue

        const existing = supplierMap.get(code)
        const isFormatForeign = format === '58' || format === '61' || format === '62'
        const type = isFormatForeign ? 'foreign' as const : 'local' as const
        const total = Math.abs(doc.grand_total || 0)

        if (existing) {
          existing.docCount++
          existing.totalVolume += total
          // Keep the most descriptive name (longest, non-numeric)
          if (doc.customer_name && doc.customer_name.length > existing.name.length) {
            existing.name = doc.customer_name
          }
          if (doc.doc_date && doc.doc_date > existing.lastDate) {
            existing.lastDate = doc.doc_date
          }
        } else {
          supplierMap.set(code, {
            name: doc.customer_name || code,
            type,
            docCount: 1,
            totalVolume: total,
            lastDate: doc.doc_date || '',
          })
        }
      }
    }

    // Upsert all extracted suppliers
    let upserted = 0
    for (const [code, info] of supplierMap) {
      const typeLabel = info.type === 'foreign' ? 'Foreign' : 'Local'
      await db
        .insert(supplierProfiles)
        .values({
          supplierCode: code,
          supplierName: info.name.trim(),
          notes: `${typeLabel} supplier. ${info.docCount} documents, last activity: ${info.lastDate}`,
          active: true,
        })
        .onConflictDoUpdate({
          target: supplierProfiles.supplierCode,
          set: {
            supplierName: info.name.trim(),
            notes: `${typeLabel} supplier. ${info.docCount} documents, last activity: ${info.lastDate}`,
            updatedAt: new Date(),
          },
        })
      upserted++
    }

    return NextResponse.json({
      success: true,
      suppliers_found: supplierMap.size,
      upserted,
      suppliers: Array.from(supplierMap.entries()).map(([code, info]) => ({
        code,
        name: info.name,
        type: info.type,
        docCount: info.docCount,
        totalVolume: Math.round(info.totalVolume),
        lastDate: info.lastDate,
      })),
    })
  } catch (error) {
    console.error('Supplier sync error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync suppliers' },
      { status: 500 }
    )
  }
}
