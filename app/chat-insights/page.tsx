'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useChatInsights } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  MessageSquare, Search, XCircle, PackageX, PackageCheck, Zap, Users, Gauge,
  ThumbsUp, ThumbsDown, Pin, Server, AlertTriangle, Activity,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS, BAR_MAX, ACTIVE_BAR, ACTIVE_DOT } from '@/components/charts/kit'
import { formatNumber } from '@/lib/constants'
import { cardVariants } from '@/lib/motion'
import { formatDate } from '@/lib/format'

// ── types (mirror the API) ──
interface ChatInsights {
  conversations: { total_conversations: number; unique_users: number; classified_conversations: number }
  feedback: { total_feedback: number; thumbs_up: number; thumbs_down: number; found_count: number; satisfaction_rate: number | null }
  intents: Array<{ intent: string; count: number; avg_response_ms: number; success_rate: number }>
  daily_activity: Array<{ day: string; conversations: number; users: number }>
  top_users: Array<{ user_id: string; display_name: string; email: string | null; conversation_count: number; last_active: string }>
  parts_bot: { total: number; not_found: number; oos: number; in_stock: number; deterministic: number; users: number; p50: number; p95: number }
  top_not_found: Array<{ query: string; count: number }>
  by_lambda: Array<{ lambda: string; count: number; not_found: number }>
  flow_decisions: Array<{ source: string | null; status: string; count: number }>
  recent_pins: Array<{ part_description: string; schema: string; lambda_target: string; source: string; status: string; vehicle_model: string | null; created_at: string }>
}

const DAY_OPTIONS = [7, 14, 30, 90] as const

// ── label maps ──
const INTENT_HE: Record<string, string> = {
  search: 'חיפוש',
  schema_position: 'מספר בשרטוט',
  confirm: 'אישור',
  reject: 'דחייה',
  question: 'שאלה',
  parts_inquiry: 'חיפוש (ישן)',
}
const intentLabel = (i: string) => INTENT_HE[i] || i

const SOURCE_HE: Record<string, string> = {
  schema_ref_correction: 'תיקון מספר',
  regular_flow_approval: 'אישור חיפוש',
  agent_correction_seed: 'זריעה',
  thumbs_up_aggregated: 'אגרגציית לייק',
  thumbs_down_single: 'דיסלייק',
}
const sourceLabel = (s: string | null) => (s == null ? 'ידני' : SOURCE_HE[s] || s)

const STATUS_HE: Record<string, string> = {
  approved: 'מאושר',
  pending: 'ממתין',
  rejected: 'נדחה',
}
const statusLabel = (s: string) => STATUS_HE[s] || s
const statusVariant = (s: string): 'success' | 'warning' | 'destructive' | 'secondary' =>
  s === 'approved' ? 'success' : s === 'pending' ? 'warning' : s === 'rejected' ? 'destructive' : 'secondary'

const INTENT_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f87171', '#22d3ee', '#fb7185']

// ── helpers ──
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0)

function EmptyState({ label = '— אין נתונים —', className }: { label?: string; className?: string }) {
  return <div className={cn('py-10 text-center text-sm text-muted-foreground', className)}>{label}</div>
}


function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {[...Array(7)].map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-16 mb-3" />
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
            <CardContent><Skeleton className="w-full h-[280px] rounded-lg" /></CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── KPI stat card ──
function StatCard({ icon: Icon, label, value, format = 'number', sub, color, i }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any; label: string; value: number; format?: 'number' | 'percent'; sub?: string; color?: string; i: number
}) {
  return (
    <motion.div custom={i} variants={cardVariants} initial="hidden" animate="visible">
      <Card className="overflow-hidden h-full">
        <CardContent className="p-3 md:p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </div>
          <div className={cn('text-xl md:text-2xl font-bold', color)}>
            <AnimatedCounter value={value} format={format} />
          </div>
          {sub && <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── main content ──
function ChatInsightsContent() {
  const { t } = useLocale()
  const { get, setMany } = useUrlParams()
  const [days, setDays] = useState<number>(() => {
    const d = parseInt(get('days') || '30', 10)
    return (DAY_OPTIONS as readonly number[]).includes(d) ? d : 30
  })

  useEffect(() => { setMany({ days: days === 30 ? null : String(days) }) }, [days, setMany])

  const { data, isLoading, isError, refetch } = useChatInsights(days)
  const d = data as ChatInsights | undefined

  // ── derived ──
  const pb = d?.parts_bot
  const pbTotal = pb?.total ?? 0

  const intentChart = useMemo(() => {
    const rows = d?.intents ?? []
    return [...rows]
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .map((r, idx) => ({
        ...r,
        label: intentLabel(r.intent),
        fill: INTENT_COLORS[idx % INTENT_COLORS.length],
      }))
  }, [d])

  const lambdaRows = useMemo(
    () => [...(d?.by_lambda ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
    [d],
  )

  const flowMatrix = useMemo(() => {
    const rows = d?.flow_decisions ?? []
    const statuses = Array.from(new Set(rows.map(r => r.status)))
    const bySource = new Map<string, { source: string | null; total: number; counts: Record<string, number> }>()
    for (const r of rows) {
      const key = r.source ?? '__null__'
      if (!bySource.has(key)) bySource.set(key, { source: r.source ?? null, total: 0, counts: {} })
      const e = bySource.get(key)!
      e.counts[r.status] = (e.counts[r.status] ?? 0) + (r.count ?? 0)
      e.total += r.count ?? 0
    }
    const list = Array.from(bySource.values()).sort((a, b) => b.total - a.total)
    return { statuses, list }
  }, [d])

  const dailyChart = useMemo(() => (d?.daily_activity ?? []).map(r => ({
    ...r,
    label: r.day?.slice(5) ?? r.day,
  })), [d])

  const fb = d?.feedback
  const satisfaction = fb?.satisfaction_rate

  if (isLoading) return <LoadingSkeleton />

  if (isError || !d) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
          <div className="text-muted-foreground">{t('noInsights')}</div>
          <button
            onClick={() => refetch()}
            className="h-9 rounded-md border border-input bg-transparent px-4 text-sm hover:bg-muted/50 transition-colors"
          >
            נסה שוב
          </button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* 1 ── Header + day-range */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            {t('chatInsights')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{`${days} ימים אחרונים`}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-input bg-background p-1">
          {DAY_OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => setDays(opt)}
              className={cn(
                'h-7 min-w-[44px] rounded-md px-2.5 text-sm font-medium transition-colors',
                days === opt ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {`${opt} ימים`}
            </button>
          ))}
        </div>
      </div>

      {/* 2 ── Diego parts-bot KPIs (headline) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Zap className="h-4 w-4 text-amber-500" />
          בוט חלפים (Diego / טלגרם)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 sm:gap-3">
          <StatCard i={0} icon={Search} label="חיפושים" value={pbTotal} color="text-primary" sub={`${formatNumber(pb?.users ?? 0)} משתמשים`} />
          <StatCard i={1} icon={XCircle} label="לא נמצא" value={pct(pb?.not_found ?? 0, pbTotal)} format="percent" color="text-destructive" sub={`${formatNumber(pb?.not_found ?? 0)} פניות`} />
          <StatCard i={2} icon={PackageX} label="חסר במלאי" value={pct(pb?.oos ?? 0, pbTotal)} format="percent" color="text-amber-500" sub={`${formatNumber(pb?.oos ?? 0)} פניות`} />
          <StatCard i={3} icon={PackageCheck} label="במלאי" value={pct(pb?.in_stock ?? 0, pbTotal)} format="percent" color="text-emerald-500" sub={`${formatNumber(pb?.in_stock ?? 0)} פניות`} />
          <StatCard i={4} icon={Zap} label="ניווט דטרמיניסטי" value={pct(pb?.deterministic ?? 0, pbTotal)} format="percent" color="text-sky-400" sub={`${formatNumber(pb?.deterministic ?? 0)} פניות`} />
          <StatCard i={5} icon={Gauge} label="זמן תגובה p95" value={Math.round((pb?.p95 ?? 0) / 1000)} color="text-foreground" sub={`p50 ${formatNumber(Math.round((pb?.p50 ?? 0) / 1000))} ש׳׳`} />
          <StatCard i={6} icon={Users} label="משתמשים ייחודיים" value={pb?.users ?? 0} color="text-primary" />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 3 ── LLM intent breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> סיווג כוונות (LLM)</CardTitle>
          </CardHeader>
          <CardContent>
            {intentChart.length === 0 ? <EmptyState /> : (
              <>
                <ResponsiveContainer width="100%" height={Math.max(180, intentChart.length * 42)}>
                  <BarChart data={intentChart} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <ChartGrid vertical horizontal={false} />
                    <XAxis type="number" {...AXIS_PROPS} />
                    <YAxis type="category" dataKey="label" {...AXIS_PROPS} width={84} />
                    <Tooltip
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any, _name: any, props: any) => {
                        const p = props.payload
                        return [`${formatNumber(value)} · ${p.success_rate ?? 0}% הצלחה · ${formatNumber(p.avg_response_ms ?? 0)}ms`, p.label]
                      }}
                    />
                    <Bar activeBar={ACTIVE_BAR} dataKey="count" radius={BAR_RADIUS.horizontal} maxBarSize={BAR_MAX} animationDuration={700}>
                      {intentChart.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1.5">
                  {intentChart.map(r => (
                    <div key={r.intent} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: r.fill }} />
                        <span className="text-foreground">{r.label}</span>
                      </span>
                      <span className="flex items-center gap-3 text-muted-foreground tabular-nums">
                        <span>{formatNumber(r.count)}</span>
                        <Badge variant={r.success_rate >= 80 ? 'success' : r.success_rate >= 50 ? 'warning' : 'destructive'} className="h-5">
                          {r.success_rate ?? 0}%
                        </Badge>
                        <span dir="ltr">{formatNumber(r.avg_response_ms ?? 0)}ms</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 4 ── Per-portal (by_lambda) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" /> לפי פורטל</CardTitle>
          </CardHeader>
          <CardContent>
            {lambdaRows.length === 0 ? <EmptyState /> : (
              <div className="space-y-3">
                {lambdaRows.map((r, idx) => {
                  const max = lambdaRows[0]?.count || 1
                  const nfPct = pct(r.not_found, r.count)
                  return (
                    <motion.div key={r.lambda} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-mono font-medium text-foreground" dir="ltr">{r.lambda}</span>
                        <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
                          <span>{formatNumber(r.count)}</span>
                          {r.not_found > 0 && (
                            <Badge variant={nfPct >= 40 ? 'destructive' : 'warning'} className="h-5">
                              {nfPct}% לא נמצא
                            </Badge>
                          )}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                        <div className="h-full bg-emerald-500/70" style={{ width: `${((r.count - r.not_found) / max) * 100}%` }} />
                        <div className="h-full bg-destructive/70" style={{ width: `${(r.not_found / max) * 100}%` }} />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 5 ── Top not-found (failure queue) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><XCircle className="h-4 w-4 text-destructive" /> שאילתות שלא נמצאו</CardTitle>
          </CardHeader>
          <CardContent>
            {(d.top_not_found?.length ?? 0) === 0 ? <EmptyState /> : (
              <div className="max-h-[320px] overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {d.top_not_found.map((r, idx) => (
                      <motion.tr key={`${r.query}-${idx}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="py-2 ps-1 w-7 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="py-2 text-start" dir="rtl">{r.query || '—'}</td>
                        <td className="py-2 pe-1 text-end">
                          <Badge variant="destructive" className="h-5 tabular-nums">{formatNumber(r.count)}</Badge>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 6 ── Conversation + feedback (web chat) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" /> צ׳אט אתר ומשוב</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="text-lg font-bold text-primary tabular-nums">{formatNumber(d.conversations?.total_conversations ?? 0)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">שיחות</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="text-lg font-bold tabular-nums">{formatNumber(d.conversations?.unique_users ?? 0)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">משתמשים</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="text-lg font-bold tabular-nums">{formatNumber(d.conversations?.classified_conversations ?? 0)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">סווגו</div>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">שביעות רצון</span>
                <span className={cn('text-2xl font-bold tabular-nums', satisfaction == null ? 'text-muted-foreground' : satisfaction >= 70 ? 'text-emerald-500' : satisfaction >= 40 ? 'text-amber-500' : 'text-destructive')}>
                  {satisfaction == null ? '—' : `${Math.round(satisfaction)}%`}
                </span>
              </div>
              {satisfaction != null && (
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn('h-full', satisfaction >= 70 ? 'bg-emerald-500' : satisfaction >= 40 ? 'bg-amber-500' : 'bg-destructive')} style={{ width: `${satisfaction}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="flex items-center gap-1.5 text-emerald-500"><ThumbsUp className="h-4 w-4" /> {formatNumber(fb?.thumbs_up ?? 0)}</span>
                <span className="flex items-center gap-1.5 text-destructive"><ThumbsDown className="h-4 w-4" /> {formatNumber(fb?.thumbs_down ?? 0)}</span>
                <span className="text-muted-foreground text-xs">{formatNumber(fb?.total_feedback ?? 0)} משובים</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 7 ── Flow decisions (learned pins) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Pin className="h-4 w-4 text-primary" /> החלטות זרימה לפי מקור</CardTitle>
          </CardHeader>
          <CardContent>
            {flowMatrix.list.length === 0 ? <EmptyState /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-2 text-start font-medium">מקור</th>
                      {flowMatrix.statuses.map(s => (
                        <th key={s} className="pb-2 text-end font-medium">{statusLabel(s)}</th>
                      ))}
                      <th className="pb-2 text-end font-medium pe-1">סה׳׳כ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowMatrix.list.map((row, idx) => (
                      <motion.tr key={row.source ?? `null-${idx}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="py-2">
                          <Badge variant="secondary" className="font-normal">{sourceLabel(row.source)}</Badge>
                        </td>
                        {flowMatrix.statuses.map(s => (
                          <td key={s} className="py-2 text-end tabular-nums text-muted-foreground">
                            {row.counts[s] ? formatNumber(row.counts[s]) : '·'}
                          </td>
                        ))}
                        <td className="py-2 text-end tabular-nums font-semibold pe-1">{formatNumber(row.total)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Pin className="h-4 w-4" /> פינים אחרונים</CardTitle>
          </CardHeader>
          <CardContent>
            {(d.recent_pins?.length ?? 0) === 0 ? <EmptyState /> : (
              <div className="max-h-[320px] overflow-y-auto -mx-1">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-2 px-1 text-start font-medium">מונח → שרטוט</th>
                      <th className="pb-2 px-1 text-start font-medium">מקור</th>
                      <th className="pb-2 px-1 text-end font-medium">פורטל</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recent_pins.map((p, idx) => (
                      <motion.tr key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }} className="border-b last:border-0 hover:bg-muted/40 transition-colors align-top">
                        <td className="py-2 px-1">
                          <div className="font-medium" dir="rtl">{p.part_description || '—'}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-[180px]" dir="ltr">{p.schema || '—'}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {p.vehicle_model && <span className="text-[10px] text-muted-foreground">{p.vehicle_model}</span>}
                            <span className="text-[10px] text-muted-foreground/70">{formatDate(p.created_at)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-1">
                          <Badge variant="secondary" className="font-normal whitespace-nowrap">{sourceLabel(p.source)}</Badge>
                          {p.status && p.status !== 'approved' && (
                            <Badge variant={statusVariant(p.status)} className="mt-1 font-normal whitespace-nowrap">{statusLabel(p.status)}</Badge>
                          )}
                        </td>
                        <td className="py-2 px-1 text-end font-mono text-xs" dir="ltr">{p.lambda_target || '—'}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 8 ── Daily activity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> פעילות יומית</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyChart.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dailyChart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <ChartGrid />
                <XAxis dataKey="label" {...AXIS_PROPS} tickLine={{ stroke: '#4a5168' }} axisLine={{ stroke: '#4a5168' }} />
                <YAxis {...AXIS_PROPS} tickLine={{ stroke: '#4a5168' }} axisLine={{ stroke: '#4a5168' }} allowDecimals={false} />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => [formatNumber(value), name === 'conversations' ? 'שיחות' : 'משתמשים']}
                />
                <Area activeDot={ACTIVE_DOT} type="monotone" dataKey="conversations" stroke="#60a5fa" strokeWidth={2} fill="url(#convGrad)" />
                <Area activeDot={ACTIVE_DOT} type="monotone" dataKey="users" stroke="#34d399" strokeWidth={2} fill="url(#userGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 9 ── Top users */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> משתמשים מובילים</CardTitle>
        </CardHeader>
        <CardContent>
          {(d.top_users?.length ?? 0) === 0 ? <EmptyState /> : (
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="pb-2 text-start font-medium">משתמש</th>
                    <th className="pb-2 text-end font-medium">שיחות</th>
                    <th className="pb-2 text-end font-medium">פעיל לאחרונה</th>
                  </tr>
                </thead>
                <tbody>
                  {d.top_users.map((u, idx) => (
                    <motion.tr key={u.user_id || idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="py-2">
                        <div className="font-medium truncate max-w-[220px]" dir="rtl">{u.display_name || u.user_id}</div>
                        {u.email && <div className="text-xs text-muted-foreground truncate max-w-[220px]" dir="ltr">{u.email}</div>}
                      </td>
                      <td className="py-2 text-end tabular-nums font-semibold">{formatNumber(u.conversation_count)}</td>
                      <td className="py-2 text-end text-muted-foreground text-xs">{formatDate(u.last_active)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
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
