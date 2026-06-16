import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb, query } from '@/lib/db'
import { deliveries, deliveryStatusLog } from '@/lib/db/schema'
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm'
import { fetchDocumentDetail } from '@/lib/finansit-client'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { searchParams } = new URL(request.url)

    const status = searchParams.get('status')
    const driver = searchParams.get('driver')
    const dateFrom = searchParams.get('from')
    const dateTo = searchParams.get('to')

    const conditions = []
    if (status) conditions.push(eq(deliveries.status, status as any))
    if (driver) conditions.push(eq(deliveries.driverName, driver))
    if (dateFrom) conditions.push(gte(deliveries.createdAt, new Date(dateFrom)))
    if (dateTo) conditions.push(lte(deliveries.createdAt, new Date(dateTo + 'T23:59:59Z')))

    const rows = await db
      .select()
      .from(deliveries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(deliveries.createdAt))

    // No operational dispatches recorded yet → surface the real delivery-note
    // history (format 21) so the page isn't empty. These are completed
    // deliveries (status 'delivered'); they switch to live dispatch data once
    // the dispatch flow (POST) is used.
    if (rows.length === 0) {
      const docRes = await query(
        `SELECT year, doc_number, customer_code, customer_name,
                doc_date::text AS doc_date, grand_total
         FROM dashboard.documents
         WHERE format='21' AND doc_date IS NOT NULL
         ORDER BY doc_date DESC
         LIMIT 300`,
      )
      const docDeliveries = docRes.rows.map((r: any) => ({
        id: `doc-${r.year}-${r.doc_number}`,
        documentNumber: r.doc_number,
        customerCode: r.customer_code,
        customerName: r.customer_name,
        customerAddress: null,
        driverName: null,
        status: 'delivered',
        total: Number(r.grand_total) || 0,
        createdAt: r.doc_date,
        deliveredAt: r.doc_date,
        source: 'document',
      }))
      return NextResponse.json({ deliveries: docDeliveries })
    }

    return NextResponse.json({ deliveries: rows })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch deliveries' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const body = await request.json()
    const { document_number, driver_name } = body

    if (!document_number) {
      return NextResponse.json({ error: 'document_number is required' }, { status: 400 })
    }

    // Fetch document details from Finansit (format 21 = delivery note)
    let docDetail: any = null
    try {
      docDetail = await fetchDocumentDetail(21, document_number)
    } catch {
      // Document may not exist in Finansit, allow manual creation
    }

    const customerCode = docDetail?.customer_code || body.customer_code || ''
    const customerName = docDetail?.customer_name || body.customer_name || ''
    const customerAddress = docDetail?.address || body.customer_address || ''

    const [newDelivery] = await db
      .insert(deliveries)
      .values({
        documentNumber: String(document_number),
        customerCode,
        customerName,
        customerAddress,
        driverName: driver_name || null,
        status: driver_name ? 'assigned' : 'pending',
        assignedAt: driver_name ? new Date() : null,
      })
      .returning()

    // Log initial status
    await db.insert(deliveryStatusLog).values({
      deliveryId: newDelivery.id,
      status: newDelivery.status,
      changedBy: 'system',
      notes: `Created from document ${document_number}`,
    })

    return NextResponse.json(newDelivery, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create delivery' },
      { status: 500 }
    )
  }
}
