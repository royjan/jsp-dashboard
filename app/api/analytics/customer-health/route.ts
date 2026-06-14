export const maxDuration = 120

import { NextResponse } from 'next/server'
import { getCustomerAnalytics } from '@/lib/services/analytics-service'
import { scoreAllCustomers, CustomerInput } from '@/lib/services/customer-health'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('date_from') || undefined
    const dateTo = searchParams.get('date_to') || undefined

    const analytics = await getCustomerAnalytics(dateFrom, dateTo)
    const customers = (analytics?.customers || []) as CustomerInput[]
    const summary = scoreAllCustomers(customers)

    return NextResponse.json(summary)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
