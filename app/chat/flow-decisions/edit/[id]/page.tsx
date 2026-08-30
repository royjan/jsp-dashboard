'use client'

import { Suspense, use } from 'react'
import FlowDecisionsPage from '@/components/chat-admin/flow/FlowDecisionsPage'

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <div className="chat-admin">
      <Suspense fallback={<div className="p-8 text-slate-400">Loading…</div>}>
        <FlowDecisionsPage initialEditId={id} />
      </Suspense>
    </div>
  )
}
