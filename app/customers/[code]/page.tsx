import { CustomerDetailView } from './customer-detail-view'
import { CUSTOMER_TABS, type CustomerTab } from './tabs'

// `?tab=timeline` (or any other tab name) opens that tab directly — the form
// diego-web links with. /customers/[code]/[tab] is the path form of the same.
// An unknown value is ignored rather than 404'd: a stale link should still land
// on the customer.
export default async function CustomerDetailPage({
  params, searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const { code } = await params
  const { tab } = await searchParams
  const wanted = Array.isArray(tab) ? tab[0] : tab
  const initialTab = CUSTOMER_TABS.includes(wanted as CustomerTab) ? (wanted as CustomerTab) : undefined
  return <CustomerDetailView code={code} initialTab={initialTab} />
}
