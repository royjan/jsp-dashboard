/**
 * Load one or more fiscal years of the books into `books.*`.
 *
 * A closed year is loaded once and never changes; the live year is topped up
 * afterwards by the refresh loop. A year's 7UPD is a 6-10 minute physical walk
 * of the ERP file, which is why this is a script and not an HTTP route.
 *
 *   npx tsx scripts/books-backfill.ts --years 2024-2026
 *   npx tsx scripts/books-backfill.ts --years 2026 --from-dir ~/WebstormProjects/jan-books/data
 *   npx tsx scripts/books-backfill.ts --years 2021 --only 7UPD,7MAM
 *
 * `--from-dir` loads already-extracted `<year>/<TABLE>.bin` files instead of
 * pulling from the ERP — the same bytes, minutes faster, and the way the
 * years already extracted get loaded without re-walking them.
 */

import fs from 'fs'
import path from 'path'

// The Next runtime loads .env.local for us; a bare tsx process does not.
for (const file of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

import { activeYear, extractTable, tablesPresent } from '../lib/books/extract'
import { BOOKS_TABLES } from '../lib/books/layouts'
import { ensureBooksSchema, loadTable, setYearWatermark } from '../lib/books/load'

function parseYears(spec: string): number[] {
  const years: number[] = []
  for (const part of spec.split(',')) {
    const range = part.trim().match(/^(\d{4})-(\d{4})$/)
    if (range) {
      for (let y = Number(range[1]); y <= Number(range[2]); y++) years.push(y)
    } else if (part.trim()) {
      years.push(Number(part.trim()))
    }
  }
  return years
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const yearsArg = arg('years')
  if (!yearsArg) {
    console.error('usage: npx tsx scripts/books-backfill.ts --years 2024-2026 [--from-dir DIR] [--only 7UPD,7MAM]')
    process.exit(1)
  }
  const years = parseYears(yearsArg)
  const fromDir = arg('from-dir')?.replace(/^~/, process.env.HOME ?? '~')
  const only = arg('only')?.split(',').map((s) => s.trim())
  const tables = only ?? BOOKS_TABLES

  await ensureBooksSchema()
  const live = await activeYear().catch(() => Math.max(...years))
  console.log(`active year: ${live}${fromDir ? `  ·  source: ${fromDir}` : '  ·  source: ERP'}`)

  for (const year of years) {
    console.log(`\n=== j${year} ${'='.repeat(40)}`)
    const present = fromDir ? null : await tablesPresent(year).catch(() => null)
    let total = 0

    for (const table of tables) {
      const started = Date.now()
      try {
        let blob: Buffer
        if (fromDir) {
          const file = path.join(fromDir, String(year), `${table}.bin`)
          if (!fs.existsSync(file)) continue
          blob = fs.readFileSync(file)
        } else {
          if (present && !present.has(table)) continue
          blob = (await extractTable(table, year)).blob
        }
        if (!blob.length) continue
        const written = await loadTable(year, table, blob)
        total += written
        console.log(`${table.padEnd(12)} ${String(written).padStart(8)} rows  `
          + `${((Date.now() - started) / 1000).toFixed(1)}s`)
      } catch (e) {
        console.error(`${table.padEnd(12)} FAILED: ${e instanceof Error ? e.message : e}`)
      }
    }

    await setYearWatermark(year, year === live ? 'live' : 'closed',
                           fromDir ? 'backfill:local' : 'backfill:erp')
    console.log(`j${year}: ${total.toLocaleString()} rows written`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
