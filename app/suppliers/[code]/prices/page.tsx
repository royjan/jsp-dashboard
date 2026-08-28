'use client'

import { useParams } from 'next/navigation'
import { PriceUploader } from '@/components/suppliers/PriceUploader'
import { SupplierCatalog } from '@/components/xpart/SupplierCatalog'
import { useLocale } from '@/lib/locale-context'

/**
 * The supplier's prices.
 *
 * The catalogue comes first because it is the thing with data in it — Xpart
 * holds tens of thousands of live prices per supplier, while the uploader below
 * has never had a completed upload. The uploader stays: it is how a price list
 * that never went through Xpart gets in.
 */
export default function SupplierPricesPage() {
  const { code } = useParams<{ code: string }>()
  const { locale } = useLocale()
  const isHe = locale === 'he'

  return (
    <div className="space-y-6">
      <SupplierCatalog supplierCode={code} isHe={isHe} />
      <PriceUploader supplierCode={code} />
    </div>
  )
}
