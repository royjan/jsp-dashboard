import { CustomerDetailView } from './customer-detail-view'

export default async function CustomerDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <CustomerDetailView code={code} />
}
