'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronDown, RefreshCw, Sparkles } from 'lucide-react'

const STORAGE_KEY = 'morning-brief-collapsed'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'בוקר טוב'
  if (hour >= 12 && hour < 17) return 'צהריים טובים'
  return 'ערב טוב'
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

interface MorningBriefData {
  summary: string
  bullets: string[]
  generatedAt: string
  cached: boolean
}

/** Extract plain text from a value that might be a JSON string */
function extractText(value: unknown): string {
  if (typeof value !== 'string') return String(value ?? '')
  const trimmed = value.trim()
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      return obj.summary || obj.text || obj.content || trimmed
    } catch { /* not JSON */ }
  }
  return trimmed
}

export function MorningBrief() {
  const [collapsed, setCollapsed] = useState(false)

  // Restore collapsed state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'true') setCollapsed(true)
    } catch {}
  }, [])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
  }

  const { data, isLoading, isError, refetch, isFetching } = useQuery<MorningBriefData>({
    queryKey: ['morning-brief'],
    queryFn: async () => {
      const res = await fetch('/api/ai/morning-brief')
      if (!res.ok) throw new Error('Failed to fetch morning brief')
      return res.json()
    },
    staleTime: 4 * 60 * 60 * 1000, // 4 hours
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardHeader className="pb-0 cursor-pointer select-none" onClick={toggleCollapsed}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{getGreeting()}</CardTitle>
              {data?.generatedAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  עודכן ב-{formatTime(data.generatedAt)}
                  {data.cached && ' (מטמון)'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!isLoading && (
              <button
                onClick={(e) => { e.stopPropagation(); refetch() }}
                disabled={isFetching}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                title="רענון"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            )}
            <motion.div
              animate={{ rotate: collapsed ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </motion.div>
          </div>
        </div>
      </CardHeader>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <CardContent className="pt-3">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : isError ? (
                <div className="flex items-center justify-between py-2">
                  <p className="text-sm text-muted-foreground">לא הצלחנו לטעון את התקציר</p>
                  <button
                    onClick={() => refetch()}
                    className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    נסה שוב
                  </button>
                </div>
              ) : data ? (
                <div className="space-y-2.5" dir="rtl">
                  {data.summary && (
                    <p className="text-sm font-medium text-foreground">{extractText(data.summary)}</p>
                  )}
                  <ul className="space-y-1.5">
                    {data.bullets.map((bullet, i) => (
                      <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                        <span className="text-primary/60 mt-0.5 shrink-0">&#x2022;</span>
                        <span>{extractText(bullet)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
