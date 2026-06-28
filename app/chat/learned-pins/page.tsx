'use client'

import { Suspense } from 'react'
import { Pin } from 'lucide-react'
import LearnedPinsTab from '@/components/chat-admin/LearnedPinsTab'
import { AdminPageHeader } from '@/components/chat-admin/shared'

export default function LearnedPinsPage() {
  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Learned Pins"
        subtitle="Parts pinned to flow decisions by the learning loop — review, audit, and undo"
        icon={<Pin className="w-6 h-6" />}
      />
      <Suspense fallback={<div className="p-8 text-slate-400">Loading learned pins…</div>}>
        <LearnedPinsTab />
      </Suspense>
    </div>
  )
}
