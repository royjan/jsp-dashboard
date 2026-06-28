'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { MessagesSquare } from 'lucide-react'
import { logger } from '@/lib/logger'
import { AdminPageHeader } from '@/components/chat-admin/shared'
import type { ChatHistoryItem } from '@/types/chat-admin/analytics'
import type { FeedbackItem } from '@/types/chat-admin/feedback'

const AnalyticsTab = dynamic(
  () => import('@/components/chat-admin/AnalyticsTab').then((mod) => ({ default: mod.AnalyticsTab })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading Analytics...</div>
      </div>
    ),
  },
)

export default function ChatAnalyticsPage() {
  const [conversations, setConversations] = useState<ChatHistoryItem[]>([])
  const [feedback, setFeedback] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [conversationsResponse, feedbackResponse] = await Promise.all([
          fetch('/api/admin?type=conversations'),
          fetch('/api/admin?type=feedback'),
        ])
        if (conversationsResponse.ok) {
          const data = await conversationsResponse.json()
          setConversations(data.conversations || [])
        }
        if (feedbackResponse.ok) {
          const data = await feedbackResponse.json()
          setFeedback(data.feedback || [])
        }
      } catch (error) {
        logger.error('Error loading analytics data:', { error })
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Chat Analytics"
        subtitle="Conversation metrics, feedback analysis, and usage patterns"
        icon={<MessagesSquare className="w-6 h-6" />}
      />
      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-600 dark:text-gray-400">Loading...</div>
      ) : (
        <AnalyticsTab conversations={conversations} feedback={feedback} />
      )}
    </div>
  )
}
