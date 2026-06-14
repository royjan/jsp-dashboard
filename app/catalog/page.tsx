'use client'

import { VinCatalog } from '@/components/catalog/VinCatalog'

export default function CatalogPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">קטלוג VIN</h1>
        <p className="text-muted-foreground text-sm mt-1">
          חיפוש חלקים לפי מספר שלדה או לוחית רישוי
        </p>
      </div>
      <VinCatalog />
    </div>
  )
}
