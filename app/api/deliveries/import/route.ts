import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { deliveries, deliveryStatusLog } from '@/lib/db/schema'
import { searchDocuments, fetchDocumentDetail } from '@/lib/finansit-client'
import { eq, and } from 'drizzle-orm'

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const body = await request.json().catch(() => ({}))

    // Default to today's date
    const today = body.date || new Date().toISOString().split('T')[0]

    // Search for format 21 (delivery notes) documents for the date
    const docs = await searchDocuments({
      format: '21',
      from_date: today,
      to_date: today,
    })

    if (!docs || docs.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        message: `No delivery notes found for ${today}`,
      })
    }

    let imported = 0
    let skipped = 0

    for (const doc of docs) {
      const docNumber = doc.doc_number || doc.number || doc.document_number
      if (!docNumber) continue

      // Check if already imported
      const existing = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(eq(deliveries.documentNumber, String(docNumber)))
        .limit(1)

      if (existing.length > 0) {
        skipped++
        continue
      }

      // Fetch full document detail for customer info
      let detail: any = null
      try {
        detail = await fetchDocumentDetail(21, docNumber)
      } catch {
        // Use header info as fallback
      }

      const customerCode = detail?.customer_code || doc.customer_code || ''
      const customerName = detail?.customer_name || doc.customer_name || ''
      const customerAddress = detail?.address || ''

      const [newDelivery] = await db
        .insert(deliveries)
        .values({
          documentNumber: String(docNumber),
          customerCode,
          customerName,
          customerAddress,
          status: 'pending',
        })
        .returning()

      await db.insert(deliveryStatusLog).values({
        deliveryId: newDelivery.id,
        status: 'pending',
        changedBy: 'import',
        notes: `Imported from delivery note ${docNumber}`,
      })

      imported++
    }

    return NextResponse.json({
      imported,
      skipped,
      total: docs.length,
      date: today,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import deliveries' },
      { status: 500 }
    )
  }
}
