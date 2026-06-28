'use client'

import { Suspense } from 'react'
import FlowDecisionsPage from '@/components/chat-admin/flow/FlowDecisionsPage'

export default function Page() {
  return (
    <div dir="ltr" className="chat-admin">
      <Suspense fallback={<div className="p-8 text-muted-foreground">Loading flow decisions…</div>}>
        <FlowDecisionsPage />
      </Suspense>
    </div>
  )
}
