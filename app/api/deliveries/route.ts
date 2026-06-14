import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
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
