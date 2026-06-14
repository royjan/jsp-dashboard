import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { salesVisits } from '@/lib/db/schema'
import { desc, eq, and, gte } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { searchParams } = new URL(request.url)
    const repName = searchParams.get('rep_name') || ''
    const customerCode = searchParams.get('customer_code') || ''
    const outcome = searchParams.get('outcome') || ''
    const daysBack = parseInt(searchParams.get('days') || '30', 10)

    const since = new Date()
    since.setDate(since.getDate() - daysBack)
    const sinceStr = since.toISOString().split('T')[0]

    const conditions = [gte(salesVisits.visitDate, sinceStr)]
    if (repName) conditions.push(eq(salesVisits.repName, repName))
    if (customerCode) conditions.push(eq(salesVisits.customerCode, customerCode))
    if (outcome) conditions.push(eq(salesVisits.outcome, outcome as any))

    const visits = await db
      .select()
      .from(salesVisits)
      .where(and(...conditions))
      .orderBy(desc(salesVisits.visitDate), desc(salesVisits.createdAt))
      .limit(100)

    // Compute summary stats
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const weekStartStr = weekStart.toISOString().split('T')[0]

    const thisWeek = visits.filter((v) => v.visitDate >= weekStartStr)
    const ordered = visits.filter((v) => v.outcome === 'ordered')
    const conversionRate = visits.length > 0 ? (ordered.length / visits.length) * 100 : 0

    // Top visited customers
    const customerVisitCount: Record<string, { name: string; count: number }> = {}
    for (const v of visits) {
      if (!customerVisitCount[v.customerCode]) {
        customerVisitCount[v.customerCode] = { name: v.customerName, count: 0 }
      }
      customerVisitCount[v.customerCode].count++
    }
    const topVisited = Object.entries(customerVisitCount)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([code, { name, count }]) => ({ code, name, count }))

    return NextResponse.json({
      visits,
      stats: {
        total: visits.length,
        thisWeek: thisWeek.length,
        conversionRate: Math.round(conversionRate),
        topVisited,
      },
    })
  } catch (error) {
    console.error('[sales-rep/visits] GET Error:', error)
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
    const body = await request.json()

    const {
      rep_name,
      customer_code,
      customer_name,
      visit_date,
      visit_type,
      notes,
      items_shown,
      outcome,
      follow_up_date,
    } = body

    if (!rep_name || !customer_code || !customer_name) {
      return NextResponse.json(
        { error: 'rep_name, customer_code, customer_name are required' },
        { status: 400 }
      )
    }

    const [visit] = await db
      .insert(salesVisits)
      .values({
        repName: rep_name,
        customerCode: customer_code,
        customerName: customer_name,
        visitDate: visit_date || new Date().toISOString().split('T')[0],
        visitType: visit_type || 'planned',
        notes: notes || null,
        itemsShown: items_shown || [],
        outcome: outcome || 'interested',
        followUpDate: follow_up_date || null,
      })
      .returning()

    return NextResponse.json(visit, { status: 201 })
  } catch (error) {
    console.error('[sales-rep/visits] POST Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to log visit' },
      { status: 500 }
    )
  }
}
