'use client'

import { useParams } from 'next/navigation'
import { PriceUploader } from '@/components/suppliers/PriceUploader'

export default function SupplierPricesPage() {
  const { code } = useParams<{ code: string }>()
  return <PriceUploader supplierCode={code} />
}
