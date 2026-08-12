import { redirect } from 'next/navigation'

/**
 * Merged into /sales-rep/price-check.
 *
 * This screen and price-check answered the same counter question ("what do we
 * have, and what does it cost") through two different doors, so a rep had to
 * pick before knowing which answer they needed. price-check now carries this
 * page's per-warehouse breakdown and barcode-scanner autofocus.
 *
 * Kept as a redirect rather than deleted: reps bookmark this URL and it is
 * linked from printed material.
 */
export default function StockQuickCheckRedirect() {
  redirect('/sales-rep/price-check')
}
