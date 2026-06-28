'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { ChatHistoryItem } from '@/types/chat-admin/analytics'
import type { FeedbackItem } from '@/types/chat-admin/feedback'
import {
  TrendingUp,
  Clock,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Activity,
  Users,
  Calendar,
  BarChart3,
  Filter,
  X
} from 'lucide-react'
import { logger } from '@/lib/logger'
import { AdminStatCard } from '@/components/chat-admin/shared'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts'

interface AnalyticsTabProps {
  conversations: ChatHistoryItem[]
  feedback: FeedbackItem[]
}

interface ConversationMetrics {
  avgMessagesPerConversation: number
  avgResponseTime: number
  totalConversations: number
  totalMessages: number
  conversationsWithFeedback: number
  conversationsByDate: { date: string; count: number }[]
  messageDistribution: { range: string; count: number; conversations: { id: string; title: string; messageCount: number; user: string; date: string }[] }[]
  responseTimeDistribution: { range: string; count: number }[]
  hourlyActivity: { hour: number; count: number }[]
  dateRangeText: string
}

interface FeedbackMetrics {
  avgRating: number
  totalFeedback: number
  positiveCount: number
  negativeCount: number
  feedbackByType: { type: string; count: number }[]
  recentFeedbackScores: { date: string; score: number }[]
  feedbackRate: number
  ratingDistribution: { rating: number; count: number }[]
}

export function AnalyticsTab({ conversations, feedback }: AnalyticsTabProps) {
  // Debug logging
  logger.info('AnalyticsTab data:', { 
    conversationsCount: conversations?.length || 0, 
    feedbackCount: feedback?.length || 0,
    sampleFeedback: feedback?.[0],
    sampleConversation: conversations?.[0]
  })
  const [filters, setFilters] = useState({
    user: '',
    rating: '',
    startDate: '',
    endDate: '',
    feedbackType: '',
    conversationId: ''
  })
  const [userSuggestions, setUserSuggestions] = useState<string[]>([])
  const [showUserSuggestions, setShowUserSuggestions] = useState(false)
  const [conversationSuggestions, setConversationSuggestions] = useState<string[]>([])
  const [showConversationSuggestions, setShowConversationSuggestions] = useState(false)
  
  // Listen for user filter from other tabs
  useEffect(() => {
    // Check localStorage on mount
    const storedUserFilter = localStorage.getItem('analyticsUserFilter')
    if (storedUserFilter) {
      setFilters(prev => ({ ...prev, user: storedUserFilter }))
      localStorage.removeItem('analyticsUserFilter')
    }

    // Listen for custom event
    const handleUserFilter = (event: CustomEvent) => {
      if (event.detail?.user) {
        setFilters(prev => ({ ...prev, user: event.detail.user }))
      }
    }

    window.addEventListener('analyticsUserFilter', handleUserFilter as EventListener)
    return () => {
      window.removeEventListener('analyticsUserFilter', handleUserFilter as EventListener)
    }
  }, [])
  
  // Get unique users for autocomplete
  useEffect(() => {
    const users = new Set<string>()
    conversations.forEach(conv => {
      if (conv.userId) users.add(conv.userId)
      if (conv.userEmail) users.add(conv.userEmail)
    })
    feedback.forEach(fb => {
      if (fb.userId) users.add(fb.userId)
      if (fb.userEmail) users.add(fb.userEmail)
    })
    setUserSuggestions(Array.from(users).sort())
    
    // Get unique conversation IDs
    const convIds = new Set<string>()
    conversations.forEach(conv => {
      if (conv.conversationId) convIds.add(conv.conversationId)
    })
    setConversationSuggestions(Array.from(convIds).sort())
  }, [conversations, feedback])

  // Filter data based on filters
  const filteredData = useMemo(() => {
    let filteredConversations = [...conversations]
    let filteredFeedback = [...feedback]
    
    // Filter by user
    if (filters.user) {
      filteredConversations = filteredConversations.filter(c => 
        c.userId?.toLowerCase().includes(filters.user.toLowerCase()) ||
        c.userEmail?.toLowerCase().includes(filters.user.toLowerCase())
      )
      filteredFeedback = filteredFeedback.filter(f => 
        f.userId?.toLowerCase().includes(filters.user.toLowerCase()) ||
        f.userEmail?.toLowerCase().includes(filters.user.toLowerCase())
      )
    }
    
    // Filter by date range
    if (filters.startDate) {
      const startTime = new Date(filters.startDate).getTime()
      filteredConversations = filteredConversations.filter(c => 
        new Date(c.createdAt).getTime() >= startTime
      )
      filteredFeedback = filteredFeedback.filter(f => 
        new Date(f.createdAt).getTime() >= startTime
      )
    }
    
    if (filters.endDate) {
      const endTime = new Date(filters.endDate).getTime() + 86400000 // Add 1 day
      filteredConversations = filteredConversations.filter(c => 
        new Date(c.createdAt).getTime() <= endTime
      )
      filteredFeedback = filteredFeedback.filter(f => 
        new Date(f.createdAt).getTime() <= endTime
      )
    }
    
    // Filter by rating
    if (filters.rating) {
      filteredFeedback = filteredFeedback.filter(f => 
        f.rating === parseInt(filters.rating)
      )
    }
    
    // Filter by feedback type
    if (filters.feedbackType) {
      filteredFeedback = filteredFeedback.filter(f => 
        f.feedbackType === filters.feedbackType || f.type === filters.feedbackType
      )
    }
    
    // Filter by conversation ID
    if (filters.conversationId) {
      filteredConversations = filteredConversations.filter(c => 
        c.conversationId === filters.conversationId
      )
      filteredFeedback = filteredFeedback.filter(f => 
        f.conversationId === filters.conversationId
      )
    }
    
    return { conversations: filteredConversations, feedback: filteredFeedback }
  }, [conversations, feedback, filters])

  const conversationMetrics = useMemo<ConversationMetrics>(() => {
    const convs = filteredData.conversations
    const totalMessages = convs.reduce((sum, conv) => sum + (conv.messages?.length || 0), 0)
    const avgMessages = convs.length > 0 ? totalMessages / convs.length : 0

    // Calculate average response time
    let totalResponseTime = 0
    let responseCount = 0
    const responseTimesData: number[] = []
    
    convs.forEach(conv => {
      const messages = conv.messages || []
      for (let i = 1; i < messages.length; i++) {
        if (messages[i-1].role === 'user' && messages[i].role === 'assistant') {
          const userTime = new Date(messages[i-1].timestamp || 0).getTime()
          const assistantTime = new Date(messages[i].timestamp || 0).getTime()
          if (userTime && assistantTime) {
            const responseTime = assistantTime - userTime
            totalResponseTime += responseTime
            responseTimesData.push(responseTime / 1000) // Convert to seconds
            responseCount++
          }
        }
      }
    })
    
    const avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount / 1000 : 0

    // Count conversations with feedback
    const conversationIds = new Set(convs.map(c => c.conversationId))
    const conversationsWithFeedback = filteredData.feedback.filter(f => 
      f.conversationId && conversationIds.has(f.conversationId)
    ).length

    // Group conversations by date
    const dateGroups: { [date: string]: number } = {}
    convs.forEach(conv => {
      const timestamp = conv.createdAt
      if (timestamp) {
        const date = new Date(timestamp).toLocaleDateString('he-IL')
        if (!isNaN(new Date(timestamp).getTime())) {
          dateGroups[date] = (dateGroups[date] || 0) + 1
        }
      }
    })
    
    // Convert to array and sort by date
    const conversationsByDate = Object.entries(dateGroups)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => {
        // Parse Hebrew date format (dd.mm.yyyy) for proper sorting
        const parseHebrewDate = (dateStr: string) => {
          const parts = dateStr.split('.')
          if (parts.length === 3) {
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime()
          }
          return new Date(dateStr).getTime()
        }
        return parseHebrewDate(a.date) - parseHebrewDate(b.date)
      })
      .slice(-30) // Last 30 days

    // Message distribution with conversation details
    const messageRanges = [
      { min: 0, max: 5, label: '1-5' },
      { min: 5, max: 10, label: '6-10' },
      { min: 10, max: 20, label: '11-20' },
      { min: 20, max: Infinity, label: '20+' }
    ]
    
    const messageDistribution = messageRanges.map(range => {
      const conversationsInRange = convs.filter(c => {
        const msgCount = c.messages?.length || 0
        return msgCount > range.min && msgCount <= range.max
      })
      return { 
        range: range.label, 
        count: conversationsInRange.length,
        conversations: conversationsInRange.map(c => ({
          id: c.conversationId || '',
          title: c.title || '',
          messageCount: c.messages?.length || 0,
          user: c.userEmail || c.userId || '',
          date: new Date(c.createdAt).toLocaleDateString('he-IL')
        }))
      }
    })

    // Response time distribution
    const timeRanges = [
      { min: 0, max: 10, label: '0-10s' },
      { min: 10, max: 30, label: '10-30s' },
      { min: 30, max: 60, label: '30-60s' },
      { min: 60, max: Infinity, label: '60s+' }
    ]
    
    const responseTimeDistribution = timeRanges.map(range => {
      const count = responseTimesData.filter(time => 
        time > range.min && time <= range.max
      ).length
      return { range: range.label, count }
    })

    // Hourly activity with date range
    const hourlyData: { [hour: number]: number } = {}
    const timestamps = convs
      .map(conv => conv.createdAt)
      .filter(ts => ts && !isNaN(new Date(ts).getTime()))
      .map(ts => new Date(ts).getTime())
      .sort((a, b) => a - b)
    
    convs.forEach(conv => {
      const timestamp = conv.createdAt
      if (timestamp && !isNaN(new Date(timestamp).getTime())) {
        const hour = new Date(timestamp).getHours()
        hourlyData[hour] = (hourlyData[hour] || 0) + 1
      }
    })
    
    const hourlyActivity = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourlyData[hour] || 0
    }))

    // Calculate date range for hourly activity
    let dateRangeText = ''
    if (timestamps.length > 0) {
      const startDate = new Date(timestamps[0])
      const endDate = new Date(timestamps[timestamps.length - 1])
      const startDateStr = startDate.toLocaleDateString('he-IL')
      const endDateStr = endDate.toLocaleDateString('he-IL')
      
      if (startDateStr === endDateStr) {
        dateRangeText = ` (${startDateStr})`
      } else {
        dateRangeText = ` (${startDateStr} - ${endDateStr})`
      }
    }

    return {
      avgMessagesPerConversation: avgMessages,
      avgResponseTime,
      totalConversations: convs.length,
      totalMessages,
      conversationsWithFeedback,
      conversationsByDate,
      messageDistribution,
      responseTimeDistribution,
      hourlyActivity,
      dateRangeText
    }
  }, [filteredData])

  const feedbackMetrics = useMemo<FeedbackMetrics>(() => {
    const fb = filteredData.feedback
    logger.info('Feedback metrics calculation:', { feedbackCount: fb.length, sampleItems: fb.slice(0, 3) })
    
    // Only include ratings 1-5
    const ratings = fb.filter(f => f.rating !== undefined && f.rating !== null && f.rating > 0).map(f => f.rating!)
    const avgRating = ratings.length > 0 
      ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length 
      : 0

    const positiveCount = fb.filter(f => f.rating !== undefined && f.rating !== null && f.rating >= 4).length
    const negativeCount = fb.filter(f => f.rating !== undefined && f.rating !== null && f.rating <= 2).length

    // Group feedback by type
    const typeGroups: { [type: string]: number } = {}
    fb.forEach(f => {
      const type = f.feedbackType || f.type
      if (type) {
        typeGroups[type] = (typeGroups[type] || 0) + 1
      }
    })
    
    const feedbackByType = Object.entries(typeGroups).map(([type, count]) => ({
      type,
      count
    }))

    // Get recent feedback scores by date
    const dateScores: { [date: string]: number[] } = {}
    fb.forEach(f => {
      const timestamp = f.createdAt
      if (f.rating && timestamp && !isNaN(new Date(timestamp).getTime())) {
        const date = new Date(timestamp).toLocaleDateString('he-IL')
        if (!dateScores[date]) dateScores[date] = []
        dateScores[date].push(f.rating)
      }
    })
    
    const recentFeedbackScores = Object.entries(dateScores)
      .map(([date, scores]) => ({
        date,
        score: scores.reduce((sum, s) => sum + s, 0) / scores.length
      }))
      .sort((a, b) => {
        // Parse Hebrew date format (dd.mm.yyyy) for proper sorting
        const parseHebrewDate = (dateStr: string) => {
          const parts = dateStr.split('.')
          if (parts.length === 3) {
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime()
          }
          return new Date(dateStr).getTime()
        }
        return parseHebrewDate(a.date) - parseHebrewDate(b.date)
      })
      .slice(-14) // Last 14 days

    // Calculate feedback rate
    const feedbackRate = conversationMetrics.totalConversations > 0 
      ? (conversationMetrics.conversationsWithFeedback / conversationMetrics.totalConversations) * 100
      : 0

    // Rating distribution - include 0 rating
    const ratingDist: { [rating: number]: number } = {}
    for (let i = 1; i <= 5; i++) {
      ratingDist[i] = fb.filter(f => f.rating === i).length
    }
    
    const ratingDistribution = Object.entries(ratingDist).map(([rating, count]) => ({
      rating: parseInt(rating),
      count
    }))

    return {
      avgRating,
      totalFeedback: fb.length,
      positiveCount,
      negativeCount,
      feedbackByType,
      recentFeedbackScores,
      feedbackRate,
      ratingDistribution
    }
  }, [filteredData, conversationMetrics])

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`
    return `${(seconds / 3600).toFixed(1)}h`
  }

  const getScoreColor = (score: number): string => {
    if (score >= 4) return 'text-green-600 dark:text-green-400'
    if (score >= 3) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  // Better color palette for feedback types with semantic meaning
  const FEEDBACK_TYPE_COLORS = {
    'thumbs_up': '#10b981',      // Green for positive
    'thumbs_down': '#ef4444',    // Red for negative  
    'bug': '#f59e0b',            // Orange for bugs
    'feature': '#3b82f6',        // Blue for features
    'general': '#6b7280',        // Gray for general
    'default': '#8b5cf6'         // Purple for others
  }
  
  const getFeedbackTypeColor = (type: string) => {
    return FEEDBACK_TYPE_COLORS[type as keyof typeof FEEDBACK_TYPE_COLORS] || FEEDBACK_TYPE_COLORS.default
  }

  const clearFilters = () => {
    setFilters({
      user: '',
      rating: '',
      startDate: '',
      endDate: '',
      feedbackType: '',
      conversationId: ''
    })
  }

  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  // State for showing detailed conversation modal
  const [showConversationModal, setShowConversationModal] = useState(false)
  const [modalConversations, setModalConversations] = useState<any[]>([])
  const [modalRange, setModalRange] = useState('')
  
  // State for pie chart hover animation
  const [activeSlice, setActiveSlice] = useState<number | null>(null)

  // Custom tooltip for message distribution showing conversation details
  const CustomMessageTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      const conversations = data.conversations || []
      
      return (
        <div className="bg-gray-900 border border-gray-600 rounded-lg p-4 shadow-lg max-w-md">
          <p className="text-gray-200 font-medium mb-2">
            {`${label} messages: ${data.count} conversations`}
          </p>
          {conversations.length > 0 && (
            <div>
              <p className="text-gray-300 text-sm mb-2">Conversations:</p>
              {conversations.slice(0, 2).map((conv: any, idx: number) => (
                <div key={idx} className="text-xs text-gray-400 mb-1 p-2 bg-gray-800 rounded">
                  <div className="font-medium text-gray-200 truncate">{conv.title || conv.id}</div>
                  <div>{conv.messageCount} messages • {conv.user}</div>
                  <div className="text-gray-500">{conv.date}</div>
                </div>
              ))}
              {conversations.length > 2 && (
                <button
                  onClick={() => {
                    setModalConversations(conversations)
                    setModalRange(label)
                    setShowConversationModal(true)
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 mt-1 underline cursor-pointer"
                >
                  ...and {conversations.length - 2} more
                </button>
              )}
            </div>
          )}
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-8">
      {/* Filters */}
      <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h3 className="font-medium text-gray-900 dark:text-gray-100">Filters</h3>
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Clear filters
            </button>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          {/* User filter with autocomplete */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              User
            </label>
            <input
              type="text"
              value={filters.user}
              onChange={(e) => setFilters(prev => ({ ...prev, user: e.target.value }))}
              onFocus={() => setShowUserSuggestions(true)}
              onBlur={() => setTimeout(() => setShowUserSuggestions(false), 200)}
              placeholder="Type to search..."
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 text-sm"
            />
            {showUserSuggestions && filters.user && (
              <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-auto">
                {userSuggestions
                  .filter(u => u.toLowerCase().includes(filters.user.toLowerCase()))
                  .slice(0, 10)
                  .map(user => (
                    <button
                      key={user}
                      onClick={() => setFilters(prev => ({ ...prev, user }))}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      {user}
                    </button>
                  ))}
              </div>
            )}
          </div>
          
          {/* Rating filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Rating
            </label>
            <select
              value={filters.rating}
              onChange={(e) => setFilters(prev => ({ ...prev, rating: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 text-sm"
            >
              <option value="">All Ratings</option>
              {[5, 4, 3, 2, 1].map(rating => (
                <option key={rating} value={rating}>{rating} Stars</option>
              ))}
            </select>
          </div>
          
          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 text-sm [&::-webkit-calendar-picker-indicator]:dark:invert [&::-webkit-calendar-picker-indicator]:dark:opacity-60 [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
          </div>
          
          {/* End Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 text-sm [&::-webkit-calendar-picker-indicator]:dark:invert [&::-webkit-calendar-picker-indicator]:dark:opacity-60 [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
          </div>
          
          {/* Feedback Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Feedback Type
            </label>
            <select
              value={filters.feedbackType}
              onChange={(e) => setFilters(prev => ({ ...prev, feedbackType: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 text-sm"
            >
              <option value="">All Types</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="bug">Bug Report</option>
              <option value="feature">Feature Request</option>
              <option value="general">General</option>
            </select>
          </div>
          
          {/* Conversation ID filter with autocomplete */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Conversation ID
            </label>
            <input
              type="text"
              value={filters.conversationId}
              onChange={(e) => setFilters(prev => ({ ...prev, conversationId: e.target.value }))}
              onFocus={() => setShowConversationSuggestions(true)}
              onBlur={() => setTimeout(() => setShowConversationSuggestions(false), 200)}
              placeholder="Type to search..."
              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 text-sm"
            />
            {showConversationSuggestions && filters.conversationId && (
              <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-auto">
                {conversationSuggestions
                  .filter(c => c.toLowerCase().includes(filters.conversationId.toLowerCase()))
                  .slice(0, 10)
                  .map(conversationId => (
                    <button
                      key={conversationId}
                      onClick={() => setFilters(prev => ({ ...prev, conversationId }))}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 truncate"
                    >
                      {conversationId}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
        <AdminStatCard
          title="Total Conversations"
          value={conversationMetrics.totalConversations}
          subtitle={`${conversationMetrics.totalMessages.toLocaleString()} total messages`}
          icon={<MessageSquare className="w-6 h-6" />}
          color="blue"
        />
        <AdminStatCard
          title="Average Rating"
          value={feedbackMetrics.avgRating.toFixed(2)}
          subtitle={`From ${feedbackMetrics.totalFeedback} feedback items`}
          icon={<Activity className="w-6 h-6" />}
          color="green"
          progress={feedbackMetrics.avgRating * 20}
        />
        <AdminStatCard
          title="Avg Response Time"
          value={formatTime(conversationMetrics.avgResponseTime)}
          subtitle={`${conversationMetrics.avgMessagesPerConversation.toFixed(1)} messages per conversation`}
          icon={<Clock className="w-6 h-6" />}
          color="purple"
        />
        <AdminStatCard
          title="Feedback Rate"
          value={`${feedbackMetrics.feedbackRate.toFixed(1)}%`}
          subtitle={`${conversationMetrics.conversationsWithFeedback} conversations with feedback`}
          icon={<Users className="w-6 h-6" />}
          color="yellow"
          progress={feedbackMetrics.feedbackRate}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Conversations Over Time */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Conversations Over Time
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={conversationMetrics.conversationsByDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="date" 
                stroke="#9CA3AF"
                style={{ fontSize: '12px' }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '6px'
                }}
                labelStyle={{ color: '#E5E7EB' }}
              />
              <Area 
                type="monotone" 
                dataKey="count" 
                stroke="#0ea5e9" 
                fill="#0ea5e9" 
                fillOpacity={0.3}
                name="Conversations"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Rating Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Rating Distribution
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={feedbackMetrics.ratingDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="rating" 
                stroke="#9CA3AF"
                style={{ fontSize: '12px' }}
              />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '6px'
                }}
                labelStyle={{ color: '#E5E7EB' }}
              />
              <Bar dataKey="count" fill="#10b981" name="Count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Feedback Type Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Feedback Types Distribution
          </h3>

          {/* Chart centered */}
          <div className="flex justify-center mb-4">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={feedbackMetrics.feedbackByType}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={45}
                  fill="#8884d8"
                  dataKey="count"
                  nameKey="type"
                  animationBegin={0}
                  animationDuration={800}
                  onMouseEnter={(data, index) => setActiveSlice(index)}
                  onMouseLeave={() => setActiveSlice(null)}
                >
                  {feedbackMetrics.feedbackByType.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getFeedbackTypeColor(entry.type)}
                      stroke="#1f2937"
                      strokeWidth={2}
                      style={{
                        filter: activeSlice === index ? 'brightness(1.2)' : 'none',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-in-out'
                      }}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#f3f4f6'
                  }}
                  formatter={(value: any, name: any) => [
                    `${value} feedback${value !== 1 ? 's' : ''}`,
                    name.replace('_', ' ')
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend as horizontal list */}
          <div className="space-y-2">
            {feedbackMetrics.feedbackByType.map((entry, index) => (
              <div
                key={index}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer ${
                  activeSlice === index
                    ? 'bg-gray-700'
                    : 'hover:bg-gray-700/50'
                }`}
                onMouseEnter={() => setActiveSlice(index)}
                onMouseLeave={() => setActiveSlice(null)}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getFeedbackTypeColor(entry.type) }}
                />
                <span className="text-sm font-medium text-gray-200 capitalize flex-1">
                  {entry.type.replace('_', ' ')}
                </span>
                <span className="text-sm text-gray-400">
                  {entry.count}
                </span>
                <span className="text-sm font-semibold text-gray-300 w-12 text-right">
                  {((entry.count / feedbackMetrics.totalFeedback) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            {feedbackMetrics.feedbackByType.length === 0 && (
              <div className="text-sm text-gray-500 italic text-center py-4">
                No feedback data available
              </div>
            )}
          </div>
        </div>

        {/* Message Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Messages per Conversation
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={conversationMetrics.messageDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="range" 
                stroke="#9CA3AF"
                style={{ fontSize: '12px' }}
              />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <Tooltip content={<CustomMessageTooltip />} />
              <Bar dataKey="count" fill="#f59e0b" name="Conversations" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Response Time Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Response Time Distribution
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={conversationMetrics.responseTimeDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="range" 
                stroke="#9CA3AF"
                style={{ fontSize: '12px' }}
              />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '6px'
                }}
                labelStyle={{ color: '#E5E7EB' }}
              />
              <Bar dataKey="count" fill="#8b5cf6" name="Responses" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Hourly Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Hourly Activity Pattern{conversationMetrics.dateRangeText}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={conversationMetrics.hourlyActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="hour"
                stroke="#9CA3AF"
                style={{ fontSize: '12px' }}
                tickFormatter={(hour) => `${hour}:00`}
              />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '6px'
                }}
                labelStyle={{ color: '#E5E7EB' }}
                labelFormatter={(hour) => `${hour}:00`}
              />
              <Line 
                type="monotone" 
                dataKey="count" 
                stroke="#ec4899" 
                strokeWidth={2}
                name="Conversations"
                dot={{ fill: '#ec4899' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Average Rating Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-lg">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Average Rating Trend
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={feedbackMetrics.recentFeedbackScores}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="date"
                stroke="#9CA3AF"
                style={{ fontSize: '12px' }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis 
                stroke="#9CA3AF" 
                style={{ fontSize: '12px' }}
                domain={[0, 5]}
                ticks={[1, 2, 3, 4, 5]}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '6px'
                }}
                labelStyle={{ color: '#E5E7EB' }}
                formatter={(value: any) => value.toFixed(2)}
              />
              <Line 
                type="monotone" 
                dataKey="score" 
                stroke="#10b981" 
                strokeWidth={2}
                name="Average Rating"
                dot={{ fill: '#10b981' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Conversation Details Modal */}
      {showConversationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-96 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Conversations with {modalRange} Messages
              </h3>
              <button
                onClick={() => setShowConversationModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <div className="space-y-3">
                {modalConversations.map((conv, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="font-medium text-gray-900 dark:text-gray-100 mb-1">
                      {conv.title || conv.id}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                      {conv.messageCount} messages • {conv.user}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      {conv.date} • ID: {conv.id}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}