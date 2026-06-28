'use client'

import { Activity } from 'lucide-react'
import SystemMonitoringTab from '@/components/chat-admin/SystemMonitoringTab'
import { AdminPageHeader } from '@/components/chat-admin/shared'

export default function MonitoringPage() {
  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="System Monitoring"
        subtitle="Lambda service health, queue status, and real-time system performance"
        icon={<Activity className="w-6 h-6" />}
      />
      <SystemMonitoringTab />
    </div>
  )
}
