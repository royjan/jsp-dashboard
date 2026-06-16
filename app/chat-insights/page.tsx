'use client'

import { Suspense, useState } from 'react'
import { motion } from 'framer-motion'
import { useChatInsights } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MessageCircle, Users, ThumbsUp, ThumbsDown, Zap,
  Activity, CheckCircle,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { NUMBER_FORMAT, formatNumber } from '@/lib/constants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
    </div>
  )
}

export default function ChatInsightsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ChatInsightsContent />
    </Suspense>
  )
}

function ChatInsightsContent() {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [days, setDays] = useState(30)
  const { data, isLoading, error } = useChatInsights(days)

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-red-500 p-4">Error loading chat insights</div>
  if (!data) return null

  const convos = data.conversations || {}
  const fb = data.feedback || {}
  const intents = data.intents || []
  const daily = data.daily_activity || []
  const topUsers = data.top_users || []

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex gap-1.5 sm:gap-2">
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
              days === d
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <MessageCircle className="h-3.5 w-3.5 text-blue-500" />
                {isHe ? 'שיחות' : 'Conversations'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{NUMBER_FORMAT.format(convos.total_conversations || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Users className="h-3.5 w-3.5 text-green-500" />
                {isHe ? 'משתמשים' : 'Unique Users'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{NUMBER_FORMAT.format(convos.unique_users || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <ThumbsUp className="h-3.5 w-3.5 text-green-500" />
                {isHe ? 'שביעות רצון' : 'Satisfaction'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{fb.satisfaction_rate || 0}%</div>
              <div className="text-xs text-muted-foreground">
                {fb.thumbs_up || 0} <ThumbsUp className="inline h-3 w-3" /> / {fb.thumbs_down || 0} <ThumbsDown className="inline h-3 w-3" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <CheckCircle className="h-3.5 w-3.5 text-violet-500" />
                {isHe ? 'נמצא' : 'Found Items'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{NUMBER_FORMAT.format(fb.found_count || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Intent Distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              {isHe ? 'סוגי שאילתות' : 'Intent Distribution'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[350px] overflow-y-auto">
              {intents.map((intent: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{intent.intent}</div>
                    <div className="text-xs text-muted-foreground">
                      {intent.avg_response_ms}ms avg | {intent.success_rate}% success
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {formatNumber(intent.count)}
                  </Badge>
                </div>
              ))}
              {intents.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No intent data</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Daily Activity Chart */}
        {daily.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-500" />
                {isHe ? 'פעילות יומית' : 'Daily Activity'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[...daily].reverse()}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString()} />
                  <Bar dataKey="conversations" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Conversations" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Top Users */}
      {topUsers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-green-500" />
              {isHe ? 'משתמשים מובילים' : 'Top Users'}
              <Badge variant="secondary" className="text-xs">{topUsers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-start py-2 px-2">User</th>
                    <th className="text-end py-2 px-2">{isHe ? 'שיחות' : 'Conversations'}</th>
                    <th className="text-end py-2 px-2">{isHe ? 'פעיל אחרון' : 'Last Active'}</th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.slice(0, 15).map((u: any, i: number) => (
                    <tr key={i} className="border-b border-muted/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-2 text-sm truncate max-w-[200px]">
                        <div>{u.display_name || u.user_id}</div>
                        {u.email && u.email !== u.display_name && (
                          <div className="text-[11px] text-muted-foreground">{u.email}</div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-end font-bold">{formatNumber(u.conversation_count)}</td>
                      <td className="py-2 px-2 text-end text-xs text-muted-foreground">
                        {u.last_active ? new Date(u.last_active).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
