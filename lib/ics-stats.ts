/**
 * ics-stats.ts — Israeli vehicle-registration aggregates, straight from Postgres.
 *
 * These numbers used to come from an ICS App Runner service at
 * `pgzwvgwxtw.eu-central-1.awsapprunner.com/api/stats`. That service is GONE —
 * the hostname does not resolve, and the AWS account has no App Runner services
 * left in any region — so all three callers were failing with `fetch failed`
 * and rendering zeros: /vehicle-intelligence (0 vehicles, 0 manufacturers, an
 * empty age chart), its "שוק הרכב בישראל" section (an outright error), and the
 * overview page's Vehicle Market tile.
 *
 * The data itself was never lost: `ics."Vehicles"` lives in the SAME Neon
 * database this app already reads, 3.78M rows. The dead service was only an
 * HTTP wrapper over it, so this module is that wrapper, in-process.
 *
 * Cost: ONE sequential scan of 3.78M rows, ~10s, using GROUPING SETS so the
 * manufacturer/model, fuel, month and importer breakdowns all come out of a
 * single pass. Four separate GROUP BYs cost ~70s — the shape here is the
 * reason this is fast enough to cache rather than precompute into a table.
 *
 * 10s is still far too slow to sit in a page load, and `slowQuery` is documented
 * as background-refresh-only, so the request path NEVER waits for the scan: it
 * returns whatever is cached and kicks off a refresh if there is nothing. A
 * genuinely cold cache therefore costs one empty render, then fills. The
 * warm-cache cron is what keeps it from ever being cold.
 */

import { slowQuery } from '@/lib/db'
import { getCached, setCache, tryAcquireLock } from '@/lib/redis-client'

export interface IcsStats {
  overview: {
    totalVehicles: number
    totalManufacturers: number
    totalImporters: number
  }
  /** Manufacturer+model pairs, biggest first. Capped — the tail is thousands of one-offs. */
  topModels: Array<{ manufacturer: string; model: string; count: number }>
  fuelTypes: Array<{ type: string; count: number }>
  monthlyTrend: Array<{ month: string; count: number }>
  /** When this snapshot was computed, so callers can show its age. */
  computedAt: string
}

// BUMP THIS whenever shape() changes what it emits. Redis survives deploys and
// the TTL is 24h, so without a bump new code keeps serving yesterday's payload —
// the U+FFFD fuel label stayed on prod through a deploy that had removed it.
const CACHE_KEY = 'ics:stats:v2' // v2 drops unrenderable fuel labels
const CACHE_TTL = 86_400 // 24h — the national fleet moves slowly.
const LOCK_KEY = 'ics:stats:lock'
const LOCK_TTL = 180

/** Model rows kept. Past this the counts are single vehicles and the payload balloons. */
const TOP_MODELS_LIMIT = 500
/** Registration months kept, newest-last — ~10 years of trend. */
const TREND_MONTHS = 120

/**
 * One pass, four breakdowns.
 *
 * `grouping()` marks which set each row came from: 0 = that column is real for
 * this row, 1 = it was rolled up. The `()` set gives the grand total, which is
 * where totalVehicles comes from — counting it separately would be a second scan.
 */
const STATS_SQL = `
  WITH base AS (
    SELECT manufacturer, model, "fuelType" AS fuel, importer,
           date_trunc('month', "registrationDate")::date AS mo
    FROM ics."Vehicles"
  )
  SELECT grouping(manufacturer, model) AS g_mm,
         grouping(fuel)                AS g_f,
         grouping(mo)                  AS g_mo,
         grouping(importer)            AS g_imp,
         manufacturer, model, fuel, importer, mo,
         count(*)::int AS c
  FROM base
  GROUP BY GROUPING SETS ((manufacturer, model), (fuel), (mo), (importer), ())
`

interface StatsRow {
  g_mm: number
  g_f: number
  g_mo: number
  g_imp: number
  manufacturer: string | null
  model: string | null
  fuel: string | null
  importer: string | null
  mo: Date | string | null
  c: number
}

function shape(rows: StatsRow[]): IcsStats {
  const models: IcsStats['topModels'] = []
  const fuels: IcsStats['fuelTypes'] = []
  const trend: IcsStats['monthlyTrend'] = []
  const manufacturers = new Set<string>()
  let totalVehicles = 0
  let totalImporters = 0

  for (const r of rows) {
    // Grand total: every column rolled up.
    if (r.g_mm === 3 && r.g_f === 1 && r.g_mo === 1 && r.g_imp === 1) {
      totalVehicles = r.c
      continue
    }
    if (r.g_mm === 0) {
      const manufacturer = r.manufacturer || 'Unknown'
      manufacturers.add(manufacturer)
      models.push({ manufacturer, model: r.model || 'Unknown', count: r.c })
      continue
    }
    if (r.g_f === 0) {
      // Blank fuelType is 116k rows of missing data, not a fuel — the old
      // service's consumers filtered it by count, which kept it.
      //
      // 509 rows also carry a label that is nothing but U+FFFD replacement
      // characters: a Hebrew string mis-decoded somewhere upstream at ingest,
      // unrecoverable from here. It cleared the callers' `count > 100` filter
      // and rendered in the fuel legend as a row of empty boxes, which tells a
      // reader strictly less than omitting it does.
      if (r.fuel && !/^�+$/.test(r.fuel)) fuels.push({ type: r.fuel, count: r.c })
      continue
    }
    if (r.g_mo === 0 && r.mo) {
      const month = r.mo instanceof Date ? r.mo.toISOString().slice(0, 7) : String(r.mo).slice(0, 7)
      trend.push({ month, count: r.c })
      continue
    }
    if (r.g_imp === 0) totalImporters++
  }

  models.sort((a, b) => b.count - a.count)
  fuels.sort((a, b) => b.count - a.count)
  trend.sort((a, b) => a.month.localeCompare(b.month))

  return {
    overview: {
      totalVehicles,
      totalManufacturers: manufacturers.size,
      totalImporters,
    },
    topModels: models.slice(0, TOP_MODELS_LIMIT),
    fuelTypes: fuels,
    monthlyTrend: trend.slice(-TREND_MONTHS),
    computedAt: new Date().toISOString(),
  }
}

async function compute(): Promise<IcsStats> {
  // slowQuery, not query: the pool caps statements well under this scan's ~10s
  // and killed it with "Query read timeout". slowQuery opens its own connection
  // outside the pool, so a long analytics scan cannot occupy one of the five
  // shared ones.
  const res = await slowQuery(STATS_SQL, [], 120_000)
  return shape(res.rows as StatsRow[])
}

/** Compute + cache under a lock, so N concurrent misses cause one scan, not N. */
async function refresh(): Promise<IcsStats | null> {
  if (!(await tryAcquireLock(LOCK_KEY, LOCK_TTL))) return null
  try {
    const stats = await compute()
    await setCache(CACHE_KEY, stats, CACHE_TTL)
    return stats
  } catch (e) {
    console.error('[ics-stats] compute failed:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Cached stats.
 *
 * `force` awaits a fresh compute and re-SETs the key — that is the cron's call,
 * and the only path allowed to block on the scan.
 *
 * Without `force` this never waits: a hit returns immediately, a miss starts a
 * background refresh and returns null so the caller renders its empty state for
 * that one request. Do not "improve" this into an await — `slowQuery` is
 * documented as background-refresh-only, and blocking a page render on a 3.78M
 * row scan is what the cache exists to prevent.
 */
export async function getIcsStats(force = false): Promise<IcsStats | null> {
  if (force) return refresh()

  const cached = await getCached<IcsStats>(CACHE_KEY)
  if (cached) return cached

  // Fire-and-forget: the catch keeps an unhandled rejection out of the request.
  void refresh().catch(() => {})
  return null
}
