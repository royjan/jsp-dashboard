import { NextResponse } from 'next/server'
import { desc, asc } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { partDescriptions } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/part-descriptions/autocomplete
 * Top 100 most-used part descriptions (English + original) for the simulator's
 * part-description autocomplete input.
 */
export async function GET() {
  try {
    await initializeSecrets()
    const db = await getDb()
    const rows = await db
      .select({ description: partDescriptions.description, originalDescription: partDescriptions.originalDescription })
      .from(partDescriptions)
      .orderBy(desc(partDescriptions.usageCount), asc(partDescriptions.description))
      .limit(100)

    const set = new Set<string>()
    for (const { description, originalDescription } of rows) {
      if (description) set.add(description)
      if (originalDescription && originalDescription !== description) set.add(originalDescription)
    }
    const suggestions = Array.from(set).sort((a, b) => {
      const aHe = /[֐-׿]/.test(a)
      const bHe = /[֐-׿]/.test(b)
      if (aHe && !bHe) return 1
      if (!aHe && bHe) return -1
      return a.localeCompare(b)
    })

    return NextResponse.json({ suggestions, count: suggestions.length })
  } catch (error) {
    console.error('Error fetching part description autocomplete:', error)
    return NextResponse.json({ error: 'Failed to fetch autocomplete suggestions' }, { status: 500 })
  }
}
