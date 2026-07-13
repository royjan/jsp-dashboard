'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import ObservatoryPage from '@/components/chat-admin/observatory/ObservatoryPage'
import type { VehicleInputData } from '@/components/chat-admin/SimulatorVehicleInput'

function Inner() {
  const sp = useSearchParams()
  // Shareable deep link, e.g.
  //   ?query=oil%20filter&license_plate=38985802
  //   ?q=מסנן%20שמן&vin=VF3...&tab=tracer
  //   ?query=air%20filter&year=2021&model=3008&fuel=בנזין&engine=5G06
  const q = sp.get('query') || sp.get('q') || ''
  const tab = sp.get('tab') || 'tracer'
  const yearRaw = sp.get('year') || ''
  const vehicle: VehicleInputData = {
    vin: sp.get('vin') || undefined,
    licensePlate: sp.get('license_plate') || sp.get('plate') || undefined,
    year: /^\d{4}$/.test(yearRaw) ? parseInt(yearRaw, 10) : undefined,
    model: sp.get('model') || undefined,
    fuelType: sp.get('fuel') || sp.get('fuelType') || undefined,
    engineModel: sp.get('engine') || sp.get('engineModel') || undefined,
  }
  const hasVehicle = Object.values(vehicle).some(Boolean)
  return (
    <div dir="ltr" className="chat-admin">
      <ObservatoryPage initialQuery={q} initialTab={tab} initialVehicle={hasVehicle ? vehicle : undefined} />
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}
