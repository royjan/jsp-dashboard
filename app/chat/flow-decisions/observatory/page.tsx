'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import ObservatoryPage from '@/components/chat-admin/observatory/ObservatoryPage'

function Inner() {
  const q = useSearchParams().get('q') || ''
  return (
    <div dir="ltr" className="chat-admin">
      <ObservatoryPage initialQuery={q} />
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
