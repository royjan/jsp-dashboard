'use client'

import { Bot } from 'lucide-react'
import DiegoSessionsTab from '@/components/chat-admin/DiegoSessionsTab'
import { AdminPageHeader } from '@/components/chat-admin/shared'

export default function DiegoPage() {
  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Diego v3 Sessions"
        subtitle="ADK conversation traces — one session per car (VIN), per-node outputs and answers"
        icon={<Bot className="w-6 h-6" />}
      />
      <DiegoSessionsTab />
    </div>
  )
}
