/**
 * Stock Alert evaluation.
 *
 * For each enabled rule: resolve the target item list, fetch current stock
 * from Finansit (GET only), compare against threshold, and dispatch notifications
 * for items that crossed the threshold (respecting cooldown).
 *
 * Pure read from Finansit — no writes.
 */
import { getDb } from '@/lib/db'
import { alertRules, alertFirings, monthlySales } from '@/lib/db/schema'
import { eq, and, gte, desc, sql } from 'drizzle-orm'
import { client } from '@/lib/finansit-client'

export interface AlertRule {
  id: string
  name: string
  itemCodes: string[] | null
  topNMonths: number | null
  topN: number | null
  thresholdQty: string
  comparator: 'lte' | 'lt' | 'eq'
  recipients: string[]
  channel: string
  enabled: boolean
  cooldownHours: number
}

export interface AlertFiring {
  ruleId: string
  ruleName: string
  itemCode: string
  itemName: string | null
  stockQty: number
  thresholdQty: number
  recipients: string[]
  channel: string
}

function compare(qty: number, threshold: number, op: string): boolean {
  if (op === 'lt') return qty < threshold
  if (op === 'eq') return qty === threshold
  return qty <= threshold // default 'lte'
}

/** Resolve a rule's target item list. Top-N rules pull from dashboard.monthly_sales. */
async function resolveItemCodes(rule: AlertRule): Promise<string[]> {
  if (rule.itemCodes && rule.itemCodes.length > 0) {
    return rule.itemCodes.map(c => c.toUpperCase())
  }
  if (rule.topN && rule.topNMonths) {
    const now = new Date()
    const fromYear = now.getFullYear()
    const fromMonth = now.getMonth() + 1 - rule.topNMonths
    // Normalize (crude — good enough for 1-12 month windows)
    const year = fromMonth <= 0 ? fromYear - 1 : fromYear
    const month = fromMonth <= 0 ? 12 + fromMonth : fromMonth
    const db = await getDb()
    const rows = await db
      .select({
        itemCode: monthlySales.itemCode,
        totalQty: sql<string>`SUM(${monthlySales.quantity})`,
      })
      .from(monthlySales)
      .where(
        sql`(${monthlySales.year} * 100 + ${monthlySales.month}) >= ${year * 100 + month}`,
      )
      .groupBy(monthlySales.itemCode)
      .orderBy(desc(sql`SUM(${monthlySales.quantity})`))
      .limit(rule.topN)
    return rows.map(r => r.itemCode.toUpperCase())
  }
  return []
}

/** Check if this rule fired recently for this item (cooldown) */
async function isWithinCooldown(
  ruleId: string,
  itemCode: string,
  hours: number,
): Promise<boolean> {
  if (hours <= 0) return false
  const cutoff = new Date(Date.now() - hours * 3600 * 1000)
  const db = await getDb()
  const rows = await db
    .select({ id: alertFirings.id })
    .from(alertFirings)
    .where(
      and(
        eq(alertFirings.ruleId, ruleId),
        eq(alertFirings.itemCode, itemCode),
        gte(alertFirings.firedAt, cutoff),
        eq(alertFirings.notificationSent, true),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/** Fetch current stock qty from Finansit (GET only) */
async function getStock(itemCode: string): Promise<{ qty: number; name: string | null }> {
  try {
    const stock = await client.stock.get(itemCode)
    const qty =
      stock?.stock_qty ??
      stock?.total_qty ??
      stock?.qty ??
      (Array.isArray(stock?.warehouses)
        ? stock.warehouses.reduce(
            (s: number, w: { qty?: number }) => s + (w.qty || 0),
            0,
          )
        : 0)
    const name = (stock?.item_name || stock?.name || null) as string | null
    return { qty: typeof qty === 'number' ? qty : Number(qty) || 0, name }
  } catch {
    return { qty: -1, name: null } // -1 sentinel: fetch failed
  }
}

/**
 * Evaluate ALL enabled rules and return firings that should trigger notifications.
 * Caller is responsible for actually sending (email/SMS) and marking firings.sent=true.
 */
export async function evaluateRules(): Promise<AlertFiring[]> {
  const db = await getDb()
  const rules = (await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.enabled, true))) as unknown as AlertRule[]

  const firings: AlertFiring[] = []

  for (const rule of rules) {
    const threshold = parseFloat(rule.thresholdQty) || 0
    const itemCodes = await resolveItemCodes(rule)
    if (itemCodes.length === 0) continue

    for (const code of itemCodes) {
      const { qty, name } = await getStock(code)
      if (qty < 0) continue // fetch failed
      if (!compare(qty, threshold, rule.comparator)) continue

      if (await isWithinCooldown(rule.id, code, rule.cooldownHours)) continue

      firings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        itemCode: code,
        itemName: name,
        stockQty: qty,
        thresholdQty: threshold,
        recipients: rule.recipients,
        channel: rule.channel,
      })
    }
  }

  return firings
}

/** Persist a firing record. */
export async function logFiring(
  f: AlertFiring,
  sent: boolean,
  error: string | null,
): Promise<void> {
  const db = await getDb()
  await db.insert(alertFirings).values({
    ruleId: f.ruleId,
    itemCode: f.itemCode,
    itemName: f.itemName,
    stockQty: String(f.stockQty),
    thresholdQty: String(f.thresholdQty),
    notificationSent: sent,
    error,
  })
}
