export const runtime = 'nodejs'
export const maxDuration = 60

import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { getDb } from '@/lib/db'
import { competitors, competitorUploads, competitorItems } from '@/lib/db/schema'
import { initializeSecrets } from '@/lib/aws-secrets'
import { deleteCache } from '@/lib/redis-client'
import { CACHE_VERSIONS } from '@/lib/constants'
import { parseWorkbook, type SheetParseResult } from '@/lib/competitors/parse-sheets'

export async function GET() {
  try {
    await initializeSecrets()
    const db = await getDb()
    const uploads = await db
      .select()
      .from(competitorUploads)
      .orderBy(desc(competitorUploads.uploadedAt))
      .limit(50)
    return NextResponse.json({ uploads })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const force = formData.get('force') === 'true'

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    const fileName = file.name
    if (!/\.(xlsx|xls)$/i.test(fileName)) {
      return NextResponse.json({ error: 'Unsupported file format. Use Excel (xlsx/xls).' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileHash = createHash('sha256').update(buffer).digest('hex')

    // Same file already imported? Require an explicit force to duplicate history.
    if (!force) {
      const existing = await db
        .select({ id: competitorUploads.id, uploadedAt: competitorUploads.uploadedAt })
        .from(competitorUploads)
        .where(eq(competitorUploads.fileHash, fileHash))
        .limit(1)
      if (existing.length) {
        return NextResponse.json(
          { error: 'This exact file was already uploaded', existingUploadId: existing[0].id, uploadedAt: existing[0].uploadedAt },
          { status: 409 },
        )
      }
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheets = parseWorkbook(workbook)
    if (!sheets.length) {
      return NextResponse.json({ error: 'No competitor sheets found in the workbook' }, { status: 400 })
    }

    const [upload] = await db
      .insert(competitorUploads)
      .values({ fileName, fileHash, status: 'processing' })
      .returning()

    const summaries: Array<SheetParseResult & { storedRows: number }> = []
    try {
      // Case-insensitive find-or-create competitor per sheet.
      const allCompetitors = await db.select().from(competitors)
      const byLowerName = new Map(allCompetitors.map(c => [c.name.toLowerCase(), c]))

      for (const sheet of sheets) {
        let competitor = byLowerName.get(sheet.competitorName.toLowerCase())
        if (!competitor) {
          ;[competitor] = await db
            .insert(competitors)
            .values({ name: sheet.competitorName })
            .returning()
          byLowerName.set(competitor.name.toLowerCase(), competitor)
        }

        let stored = 0
        for (let i = 0; i < sheet.rows.length; i += 50) {
          const batch = sheet.rows.slice(i, i + 50)
          const inserted = await db
            .insert(competitorItems)
            .values(batch.map(row => ({
              uploadId: upload.id,
              competitorId: competitor.id,
              itemCode: row.itemCode,
              rawCode: row.rawCode,
              name: row.name,
              brand: row.brand,
              grossPrice: row.grossPrice != null ? String(row.grossPrice) : null,
              netPrice: row.netPrice != null ? String(row.netPrice) : null,
              discountPct: row.discountPct != null ? String(row.discountPct) : null,
              stockQty: row.stockQty != null ? String(row.stockQty) : null,
              stockStatus: row.stockStatus,
              oemCodes: row.oemCodes.length ? row.oemCodes : null,
              attrs: row.attrs,
            })))
            .onConflictDoNothing()
            .returning({ id: competitorItems.id })
          stored += inserted.length
        }

        await db
          .update(competitors)
          .set({ latestUploadId: upload.id, updatedAt: sql`now()` })
          .where(eq(competitors.id, competitor.id))

        summaries.push({ ...sheet, rows: [], storedRows: stored })
      }

      const totalRows = summaries.reduce((s, x) => s + x.storedRows, 0)
      const errorsCount = summaries.reduce((s, x) => s + x.errors.length, 0)
      const sheetsSummary = summaries.map(s => ({
        sheet: s.sheetName,
        competitor: s.competitorName,
        rawRows: s.rawRows,
        storedRows: s.storedRows,
        skippedRows: s.skippedRows,
        errors: s.errors.slice(0, 20),
      }))

      const [finalized] = await db
        .update(competitorUploads)
        .set({ status: 'completed', sheetsSummary, totalRows, errorsCount })
        .where(eq(competitorUploads.id, upload.id))
        .returning()

      await deleteCache(CACHE_VERSIONS.COMPETITOR_COMPARE)

      return NextResponse.json({ upload: finalized, sheets: sheetsSummary })
    } catch (processError) {
      await db
        .update(competitorUploads)
        .set({ status: 'error', sheetsSummary: summaries.map(s => ({ sheet: s.sheetName, competitor: s.competitorName, storedRows: s.storedRows })) })
        .where(eq(competitorUploads.id, upload.id))
        .catch(() => {})
      throw processError
    }
  } catch (error) {
    console.error('[competitors/upload] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process file' },
      { status: 500 },
    )
  }
}
