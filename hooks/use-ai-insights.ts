'use client'

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export function useAIInsights() {
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const query = useQuery({
    queryKey: ['ai-insights'],
    queryFn: async () => {
      const res = await fetch('/api/ai/insights')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 2 * 60 * 60 * 1000,
    retry: false,
  })

  const refreshInsights = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch('/api/ai/insights?refresh=true')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      queryClient.setQueryData(['ai-insights'], data)
    } finally {
      setIsRefreshing(false)
    }
  }, [queryClient])

  return { ...query, isLoading: query.isLoading || isRefreshing, refreshInsights }
}

function useStreamingCompletion(apiUrl: string) {
  const [completion, setCompletion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const complete = useCallback(async () => {
    setIsLoading(true)
    setCompletion('')
    setError(null)
    try {
      const res = await fetch(apiUrl)
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(errBody || `HTTP ${res.status}`)
      }
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // toTextStreamResponse returns plain text chunks
        text += decoder.decode(value, { stream: true })
        setCompletion(text)
      }

      if (!text) {
        setCompletion('ניתוח הושלם ללא תוצאות. נסה שוב.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Streaming error:', msg)
      setError(msg)
      setCompletion(`שגיאה בניתוח: ${msg}`)
    } finally {
      setIsLoading(false)
    }
  }, [apiUrl])

  return { completion, isLoading, error, complete }
}

export function useReorderAnalysis() {
  return useStreamingCompletion('/api/ai/reorder-analysis')
}

export function useStockOptimization() {
  return useStreamingCompletion('/api/ai/stock-optimization')
}
