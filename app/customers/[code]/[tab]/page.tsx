import { notFound } from 'next/navigation'
import { CustomerDetailView } from '../customer-detail-view'
import { CUSTOMER_TABS, type CustomerTab } from '../tabs'

// Deep-linkable tabs: /customers/0000000303/unpaid opens the open-debts view
// directly. Same component as /customers/[code] — only the initial tab differs.
export default async function CustomerDetailTabPage({
  params,
}: { params: Promise<{ code: string; tab: string }> }) {
  const { code, tab } = await params
  if (!CUSTOMER_TABS.includes(tab as CustomerTab)) notFound()
  return <CustomerDetailView code={code} initialTab={tab as CustomerTab} />
}
