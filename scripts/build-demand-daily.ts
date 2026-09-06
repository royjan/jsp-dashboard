/**
 * Build `dashboard.demand_daily`: aggregate the quote-line archive, then pull
 * the tail the archive does not reach from FINAPI.
 *
 * Safe to re-run. The archive pass recomputes whole days and replaces them; the
 * FINAPI pass does the same for the days it covers.
 *
 *   npx tsx --env-file=.env.local scripts/build-demand-daily.ts [--tail-only] [--from YYYY-MM-DD]
 */
import { backfillFromArchive, demandWatermark, ingestRange } from '@/lib/services/demand-store'
import { initializeSecrets } from '@/lib/aws-secrets'

async function main() {
  await initializeSecrets()
  const args = process.argv.slice(2)
  const tailOnly = args.includes('--tail-only')
  const fromArg = args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined

  if (!tailOnly) {
    console.time('archive')
    const r = await backfillFromArchive()
    console.timeEnd('archive')
    console.log(`archive: ${r.rows} (day,item) rows, ${r.from} .. ${r.to}`)
  }

  const watermark = await demandWatermark()
  const today = new Date().toISOString().slice(0, 10)
  // Re-ingest the watermark day itself: the archive may hold it only partially.
  const from = fromArg || watermark || today
  console.log(`watermark ${watermark} — ingesting ${from} .. ${today} from FINAPI`)

  if (from > today) {
    console.log('nothing to ingest')
    process.exit(0)
  }

  console.time('finapi')
  const t = await ingestRange(from, today)
  console.timeEnd('finapi')
  console.log(`finapi: ${t.quotes} quotes over ${t.days} days -> ${t.rows} (day,item) rows`)
  console.log(`new watermark: ${await demandWatermark()}`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
