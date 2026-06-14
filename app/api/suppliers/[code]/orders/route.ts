export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { supplierOrderConfirmations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocuments, fetchDocumentDetail } from '@/lib/finansit-client'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params

    // Fetch format 61 (supplier orders) from Finansit
    let orders: any[] = []
    try {
      const allDocs = await fetchDocuments(61, 100)
      orders = allDocs.filter(
        (doc: any) => doc.customer_code === code || doc.supplier_code === code
      )

      // Enrich with line items for the first 20
      const enriched = await Promise.all(
        orders.slice(0, 20).map(async (doc: any) => {
          try {
            const detail = await fetchDocumentDetail(61, doc.doc_number || doc.number, doc.year?.toString())
            return { ...doc, lines: detail?.lines || detail?.items || [] }
          } catch {
            return { ...doc, lines: [] }
          }
        })
      )
      orders = [...enriched, ...orders.slice(20)]
    } catch (e) {
      console.warn('[Suppliers] Failed to fetch format 61:', e)
    }

    // Get confirmation statuses from DB
    const db = await getDb()
    const confirmations = await db
      .select()
      .from(supplierOrderConfirmations)
      .where(eq(supplierOrderConfirmations.supplierCode, code))

    const confirmMap = Object.fromEntries(
      confirmations.map(c => [`${c.documentFormat}-${c.documentNumber}`, c])
    )

    const ordersWithStatus = orders.map((o: any) => {
      const key = `61-${o.doc_number || o.number}`
      return {
        ...o,
        confirmation: confirmMap[key] || null,
      }
    })

    return NextResponse.json({ orders: ordersWithStatus })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params
    const db = await getDb()
    const body = await request.json()

    const { documentNumber, estimatedDelivery, notes, status } = body

    if (!documentNumber) {
      return NextResponse.json({ error: 'documentNumber is required' }, { status: 400 })
    }

    // Upsert confirmation
    const existing = await db
      .select()
      .from(supplierOrderConfirmations)
      .where(
        and(
          eq(supplierOrderConfirmations.supplierCode, code),
          eq(supplierOrderConfirmations.documentNumber, documentNumber),
          eq(supplierOrderConfirmations.documentFormat, '61'),
        )
      )
      .limit(1)

    let result
    if (existing.length > 0) {
      result = await db
        .update(supplierOrderConfirmations)
        .set({
          estimatedDelivery: estimatedDelivery || existing[0].estimatedDelivery,
          notes: notes ?? existing[0].notes,
          status: status || 'confirmed',
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(supplierOrderConfirmations.id, existing[0].id))
        .returning()
    } else {
      result = await db
        .insert(supplierOrderConfirmations)
        .values({
          documentFormat: '61',
          documentNumber,
          supplierCode: code,
          estimatedDelivery: estimatedDelivery || null,
          notes: notes || null,
          status: status || 'confirmed',
          confirmedAt: new Date(),
        })
        .returning()
    }

    return NextResponse.json({ confirmation: result[0] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
