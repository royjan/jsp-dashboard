export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client, fetchDocuments } from '@/lib/finansit-client'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '30', 10)

    // Get current year dashboard for invoice + credit note counts
    const dashboard = await client.dashboard.get() as any

    const invoiceFormat = dashboard.format_totals?.find((f: any) => f.format === '11')
    const creditFormat = dashboard.format_totals?.find((f: any) => f.format === '12')

    const totalInvoices = invoiceFormat?.count || 0
    const totalInvoiceValue = invoiceFormat?.total || 0
    const totalCredits = creditFormat?.count || 0
    const totalCreditValue = Math.abs(creditFormat?.total || 0)
    const returnRate = totalInvoices > 0
      ? Math.round((totalCredits / totalInvoices) * 1000) / 10
      : 0

    // Get recent credit notes to analyze by customer
    let creditNotes: any[] = []
    try {
      creditNotes = await fetchDocuments(12, 500)
    } catch {
      creditNotes = []
    }

    // Aggregate by customer
    const customerMap = new Map<string, { code: string; name: string; count: number; total: number }>()
    for (const cn of creditNotes) {
      const code = cn.customer_code || cn.customerCode || 'unknown'
      const name = cn.customer_name || cn.customerName || code
      const total = Math.abs(cn.grand_total || cn.grandTotal || cn.total || 0)
      const existing = customerMap.get(code) || { code, name, count: 0, total: 0 }
      existing.count += 1
      existing.total += total
      customerMap.set(code, existing)
    }

    const topReturningCustomers = Array.from(customerMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    // Monthly trend from credit notes
    const monthlyMap = new Map<string, { month: string; count: number; total: number }>()
    for (const cn of creditNotes) {
      const dateStr = cn.doc_date || cn.docDate
      if (!dateStr) continue
      const month = String(dateStr).substring(0, 7) // YYYY-MM
      const total = Math.abs(cn.grand_total || cn.grandTotal || cn.total || 0)
      const existing = monthlyMap.get(month) || { month, count: 0, total: 0 }
      existing.count += 1
      existing.total += total
      monthlyMap.set(month, existing)
    }

    const monthlyTrend = Array.from(monthlyMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))

    return NextResponse.json({
      kpis: {
        total_invoices: totalInvoices,
        total_invoice_value: totalInvoiceValue,
        total_credits: totalCredits,
        total_credit_value: totalCreditValue,
        return_rate: returnRate,
      },
      top_returning_customers: topReturningCustomers,
      monthly_trend: monthlyTrend,
      credit_notes_analyzed: creditNotes.length,
    })
  } catch (error) {
    console.error('[Returns Analytics] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
