import { NextResponse } from 'next/server'
import { getDashboardData } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query as dbQuery } from '@/lib/db'
import { readQuery } from '@/lib/sqlite'

/** Compute this-month sales from the DB (same source as sales chart). */
async function getMonthSalesFromDb(): Promise<{ total: number; count: number }> {
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const today = now.toISOString().split('T')[0]

  // SQLite first (fast, local)
  try {
    const r = readQuery(
      `SELECT COALESCE(SUM(revenue), 0) as total, COALESCE(SUM(invoice_count), 0) as count
       FROM daily_sales WHERE date >= ? AND date <= ?`,
      [monthStart, today],
    )
    if (r.rows.length > 0 && parseFloat(r.rows[0].total) > 0) {
      return { total: parseFloat(r.rows[0].total), count: parseInt(r.rows[0].count) || 0 }
    }
  } catch {}

  // PostgreSQL fallback
  try {
    const r = await dbQuery(
      `SELECT COALESCE(SUM(revenue::numeric), 0) as total, COALESCE(SUM(invoice_count), 0) as count
       FROM dashboard.daily_sales WHERE date >= $1 AND date <= $2`,
      [monthStart, today],
    )
    if (r.rows.length > 0 && parseFloat(r.rows[0].total) > 0) {
      return { total: parseFloat(r.rows[0].total), count: parseInt(r.rows[0].count) || 0 }
    }
  } catch {}

  return { total: 0, count: 0 }
}

export async function GET() {
  try {
    await initializeSecrets()
  } catch (e) {
    console.warn('[Dashboard] initializeSecrets failed:', e)
  }

  // Always compute monthly sales from DB (reliable, matches chart)
  const monthSales = await getMonthSalesFromDb()

  // Try Finansit API for live KPIs (open quotes, delivery notes)
  let finansitData: any = null
  try {
    finansitData = await getDashboardData()
  } catch (e) {
    console.warn('[Dashboard] Finansit API failed, using DB fallback:', e instanceof Error ? e.message : e)
  }

  const data = {
    open_invoices: finansitData?.open_invoices ?? { count: 0, total: 0 },
    open_quotes: finansitData?.open_quotes ?? { count: 0, total: 0 },
    open_delivery_notes: finansitData?.open_delivery_notes ?? { count: 0, total: 0 },
    this_month_sales: monthSales.total > 0
      ? { count: monthSales.count, total: monthSales.total }
      : (finansitData?.this_month_sales ?? { count: 0, total: 0 }),
    format_totals: finansitData?.format_totals ?? [],
  }

  return NextResponse.json(data)
}
