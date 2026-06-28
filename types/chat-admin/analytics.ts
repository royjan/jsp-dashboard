/**
 * Loose ChatHistoryItem shape consumed by the analytics components
 * (ported from jsp-chat-js's @/lib/services re-export). Permissive on purpose —
 * the dashboard's /api/admin?type=conversations returns rows from chat_history.
 */
export interface ChatHistoryItem {
  id?: string
  conversationId?: string
  userId?: string | null
  userEmail?: string | null
  user?: string | null
  title?: string | null
  date?: string | number | Date
  createdAt: string | number | Date
  messageCount?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages?: any[]
  intent?: string | null
  [key: string]: unknown
}
