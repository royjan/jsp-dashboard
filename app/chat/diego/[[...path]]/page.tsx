'use client'

import { Suspense } from 'react'
import { Bot } from 'lucide-react'
import DiegoSessionsTab from '@/components/chat-admin/DiegoSessionsTab'
import { AdminPageHeader } from '@/components/chat-admin/shared'

/**
 * /chat/diego                      — all sessions
 * /chat/diego/<user>               — sessions of one user (customer code, padded or not)
 * /chat/diego/<user>/<session VIN> — deep link straight into a session trace
 *
 * The tab reads filter/selection from the URL itself (usePathname/useSearchParams),
 * so the catch-all segment only exists for route matching.
 */
export default function DiegoPage() {
  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Diego & Dora"
        subtitle="Diego — שיחות מלאי לפי רכב · Dora — זיכויים והחזרות: תיקי ספקים ושיחות לקוח"
        icon={<Bot className="w-6 h-6" />}
      />
      <Suspense fallback={<div className="p-8 text-muted-foreground">Loading sessions…</div>}>
        <DiegoSessionsTab />
      </Suspense>
    </div>
  )
}
