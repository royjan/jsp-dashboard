export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { alertRules } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

export async function GET() {
  try {
    const db = await getDb()
    const rows = await db
      .select()
      .from(alertRules)
      .orderBy(desc(alertRules.updatedAt))
    return NextResponse.json({ rules: rows })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      itemCodes,
      topN,
      topNMonths,
      thresholdQty,
      comparator,
      recipients,
      channel,
      cooldownHours,
      createdBy,
    } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name required' }, { status: 400 })
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: 'recipients required (array of emails)' },
        { status: 400 },
      )
    }
    const hasItems = Array.isArray(itemCodes) && itemCodes.length > 0
    const hasTopN = typeof topN === 'number' && typeof topNMonths === 'number'
    if (!hasItems && !hasTopN) {
      return NextResponse.json(
        { error: 'either itemCodes or (topN+topNMonths) required' },
        { status: 400 },
      )
    }

    const db = await getDb()
    const [inserted] = await db
      .insert(alertRules)
      .values({
        name: name.trim(),
        itemCodes: hasItems
          ? itemCodes.map((c: string) => c.toUpperCase())
          : null,
        topN: hasTopN ? topN : null,
        topNMonths: hasTopN ? topNMonths : null,
        thresholdQty: String(thresholdQty ?? 0),
        comparator: comparator === 'lt' || comparator === 'eq' ? comparator : 'lte',
        recipients,
        channel: channel || 'email',
        cooldownHours: typeof cooldownHours === 'number' ? cooldownHours : 24,
        createdBy: createdBy || null,
      })
      .returning()
    return NextResponse.json({ rule: inserted }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
