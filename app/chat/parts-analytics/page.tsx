'use client'

import { Bot } from 'lucide-react'
import SearchAnalyticsTab from '@/components/chat-admin/SearchAnalyticsTab'
import { AdminPageHeader } from '@/components/chat-admin/shared'

export default function PartsAnalyticsPage() {
  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Parts Bot Analytics"
        subtitle="Live bot outcomes — not-found %, out-of-stock %, top failures, navigation stability"
        icon={<Bot className="w-6 h-6" />}
      />
      <SearchAnalyticsTab />
    </div>
  )
}
