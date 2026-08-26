export const maxDuration = 120

import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { initializeSecrets } from '@/lib/aws-secrets'
import type { Provenance } from '@/lib/provenance'

/**
 * Per-item lead time and demand variability — the two inputs a reorder point
 * needs and this app never had.
 *
 * What was there before: `const LEAD_TIME_DAYS = 14` in app/stock/page.tsx,
 * applied to every part. Fourteen days for a part from Lubinski (days) and for
 * a part on a PSA container (weeks). And `reorderPoint = dailyDemand *
 * leadTime` with no safety term at all, which means the reorder point equals
 * expected demand over the lead time — so any month that runs above average
 * ends in a stockout roughly half the time by construction.
 *
 * There is also a supplier_profiles.lead_time_days column, editable in the
 * suppliers UI, that no stock calculation read.
 *
 * WHERE THE SUPPLIER LINK COMES FROM. Items carry a Hebrew "supplier name"
 * characteristic, and supplier profiles are keyed by Finansit code. Matching
 * those two by name is exactly the kind of fuzzy join that has already produced
 * a silent bug in this repo (Hebrew category names matched against English
 * keys, which made every demand curve identical). So this does not do that. It
 * uses the supplier we ACTUALLY BOUGHT the part from: the purchase documents
 * themselves — formats 61 (order), 62 (in transit) and 58 (supplier invoice),
 * whose customer_code IS the supplier code. Same derivation the
 * /suppliers/[code]/demand route already uses, and it is a fact rather than a
 * guess.
 *
 * VARIABILITY is the sample standard deviation of monthly quantity from
 * dashboard.monthly_sales. Sample, not population: we hold a sample of months,
 * not the whole history, and stddev_pop would understate the spread on the
 * short series that matter most.
 *
 * HONESTY. An item with fewer than MIN_MONTHS of history gets no safety stock
 * rather than a made-up one — a standard deviation over two data points is not
 * a measurement. Those items come back with `months` set so the caller can say
 * "not enough history" instead of drawing a confident number, which is the
 * mistake the old "ביטחון" column made before it was renamed to "reliability".
 */

const CACHE_KEY = 'analytics:replenishment:v1'
const TTL_SECONDS = 6 * 3600

/** Below this many months of sales, a standard deviation is noise, not a signal. */
const MIN_MONTHS = 6

/** Fallback when we have never bought the part, or the supplier has no profile. */
const DEFAULT_LEAD_TIME_DAYS = 14

export interface ReplenishmentItem {
  code: string
  /** Supplier we most recently purchased this part from, if any. */
  supplier_code: string | null
  supplier_name: string | null
  lead_time_days: number
  /** True when lead_time_days is the fallback, not a supplier's own figure. */
  lead_time_is_default: boolean
  /** Mean monthly units sold, over the months we hold. */
  monthly_avg: number
  /** Sample stddev of monthly units. Null when there is too little history. */
  monthly_stddev: number | null
  months: number
}

export interface ReplenishmentResponse {
  items: ReplenishmentItem[]
  defaultLeadTimeDays: number
  minMonths: number
  provenance: Provenance
}

export async function GET() {
  try {
    await initializeSecrets()

    const cached = await getCached<ReplenishmentResponse>(CACHE_KEY)
    if (cached) return NextResponse.json(cached)

    // One pass. `DISTINCT ON` picks the most recent purchase per item, which is
    // the right answer when a part has been bought from more than one supplier:
    // the lead time that matters is the one we would face ordering it today.
    const { rows } = await query(
      `
      WITH last_purchase AS (
        SELECT DISTINCT ON (l.item_code)
               l.item_code,
               d.customer_code AS supplier_code
          FROM dashboard.document_lines l
          JOIN dashboard.documents d
            ON d.doc_number = l.doc_number
           AND d.format     = l.format
           AND d.year       = l.year
         WHERE d.format IN ('61','62','58')
           AND l.item_code IS NOT NULL
           AND d.customer_code IS NOT NULL
         ORDER BY l.item_code, d.doc_date DESC NULLS LAST
      ),
      variability AS (
        SELECT item_code,
               AVG(quantity::numeric)          AS monthly_avg,
               STDDEV_SAMP(quantity::numeric)  AS monthly_stddev,
               COUNT(*)                        AS months
          FROM dashboard.monthly_sales
         GROUP BY item_code
      )
      SELECT v.item_code                             AS code,
             lp.supplier_code,
             sp.supplier_name,
             sp.lead_time_days,
             v.monthly_avg,
             v.monthly_stddev,
             v.months
        FROM variability v
        LEFT JOIN last_purchase lp ON lp.item_code = v.item_code
        LEFT JOIN dashboard.supplier_profiles sp ON sp.supplier_code = lp.supplier_code
       WHERE v.months > 0
      `,
      [],
    )

    const items: ReplenishmentItem[] = rows.map((r: Record<string, unknown>) => {
      const months = Number(r.months) || 0
      const supplierLead = r.lead_time_days == null ? null : Number(r.lead_time_days)
      return {
        code: String(r.code),
        supplier_code: (r.supplier_code as string) ?? null,
        supplier_name: (r.supplier_name as string) ?? null,
        lead_time_days: supplierLead ?? DEFAULT_LEAD_TIME_DAYS,
        lead_time_is_default: supplierLead == null,
        monthly_avg: Number(r.monthly_avg) || 0,
        // Withhold the number rather than publish one built on too few months.
        monthly_stddev:
          months >= MIN_MONTHS && r.monthly_stddev != null ? Number(r.monthly_stddev) : null,
        months,
      }
    })

    const withSupplierLead = items.filter(i => !i.lead_time_is_default).length

    const body: ReplenishmentResponse = {
      items,
      defaultLeadTimeDays: DEFAULT_LEAD_TIME_DAYS,
      minMonths: MIN_MONTHS,
      provenance: {
        source: 'postgres',
        asOf: new Date().toISOString(),
        rows: items.length,
        scope:
          `זמן אספקה אמיתי ל-${withSupplierLead.toLocaleString('en-US')} פריטים; ` +
          `לשאר ברירת מחדל של ${DEFAULT_LEAD_TIME_DAYS} ימים. ` +
          `סטיית תקן רק מ-${MIN_MONTHS} חודשי מכירות ומעלה.`,
      },
    }

    await setCache(CACHE_KEY, body, TTL_SECONDS)
    return NextResponse.json(body)
  } catch (err) {
    // Decline rather than return an empty map: an empty map is indistinguishable
    // from "every item is on the 14-day default", which is the exact confusion
    // this route exists to end.
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'error',
        provenance: {
          source: 'unavailable',
          reason: 'לא ניתן לחשב זמני אספקה ותנודתיות',
        } satisfies Provenance,
      },
      { status: 503 },
    )
  }
}
