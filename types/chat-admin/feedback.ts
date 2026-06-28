/**
 * Centralized FeedbackItem type definition (ported from jsp-chat-js).
 * Supports both snake_case (database) and camelCase (API) naming.
 */

export interface FeedbackItem {
  id?: string
  feedbackId?: string

  user_id?: string
  userId?: string
  user_email?: string
  userEmail?: string

  conversation_id?: string | null
  conversationId?: string | null
  message_id?: string | null
  messageId?: string | null

  type: 'thumbs_up' | 'thumbs_down' | 'found' | string
  feedbackType?: string

  created_at?: string | number | Date
  createdAt: string | number | Date
  timestamp?: number

  metadata?: Record<string, unknown>
  content?: string
  message_content?: string
  messageContent?: string
  comment?: string
  rating?: number
}

export interface FeedbackData {
  conversationId?: string | null
  messageId?: string | null
  type: 'thumbs_up' | 'thumbs_down' | 'found' | 'flow_edit' | string
  comment?: string
  metadata?: Record<string, unknown>
  userEmail?: string
  userId?: string
}

export interface FeedbackFilter {
  type?: string
  dateRange?: { from?: Date; to?: Date }
  search?: string
  userEmail?: string
}

export interface FeedbackStats {
  total: number
  thumbsUp: number
  thumbsDown: number
  found: number
  byDate?: Array<{ date: string; count: number }>
}
