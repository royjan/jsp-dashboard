'use client'

import { use } from 'react'
import { Bot } from 'lucide-react'
import DiegoSessionsTab from '@/components/chat-admin/DiegoSessionsTab'
import { AdminPageHeader } from '@/components/chat-admin/shared'

/**
 * /chat/diego                      — all sessions
 * /chat/diego/<user>               — sessions of one user (customer code, padded or not)
 * /chat/diego/<user>/<session VIN> — deep link straight into a session trace
 */
export default function DiegoPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = use(params)
  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Diego v3 Sessions"
        subtitle="ADK conversation traces — one session per car (VIN), per-node outputs and answers"
        icon={<Bot className="w-6 h-6" />}
      />
      <DiegoSessionsTab initialPath={(path ?? []).map(decodeURIComponent)} />
    </div>
  )
}
