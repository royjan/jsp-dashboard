'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, XCircle, PackageX, CheckCircle2, Cpu, Gauge, Activity, RefreshCw, Shuffle, Pin } from 'lucide-react'
import { AdminStatCard } from './shared'
import { Panel } from './Panel'
import { Delta } from './Delta'
import { OutcomeTrendChart } from './charts/OutcomeTrendChart'
import { PortalBars } from './charts/PortalBars'
import { CoverageDonut } from './charts/CoverageDonut'
import { IntentBreakdown } from './charts/IntentBreakdown'
import { FixQueue } from './FixQueue'
import { LearningLoopStrip } from './LearningLoopStrip'
import { SkeletonDashboard } from './SkeletonDashboard'

interface PartsBotMetrics {
  total: number
  notFound: number
  notFoundRate: number
  oos: number
  oosRate: number
  inStock: number
  inStockRate: number
  pg: number
  pgCoverage: number
  uniqueUsers: number
  p50: number
  p95: number
  topNotFound: Array<{ query: string; count: number }>
  topOOS: Array<{ query: string; count: number }>
  byFlowSource: Array<{ source: string; count: number }>
  byIntent: Array<{ intent: string; count: number; llmShare: number }>
  byLambda: Array<{ lambda: string; count: number; notFound: number; notFoundRate: number; p95: number }>
  schemaFlips: Array<{ query: string; schemas: string[]; n: number }>
  daily: Array<{ date: string; total: number; notFound: number; oos: number }>
  prev: { total: number; notFoundRate: number; oosRate: number; inStockRate: number; pgCoverage: number; p95: number }
  learnedPinsTotal: number
  learnedPinsAddedInRange: number
  learnedPinsDaily: Array<{ date: string; added: number }>
}

const DAY_OPTIONS = [7, 14, 30, 90]
const GATE_OPTIONS = ['', 'opel_old', 'mg', 'other']
// Stable portal list (don't source from filtered data — that collapses the dropdown once a portal is picked).
const PORTAL_OPTIONS = ['', 'psa', 'saic', 'vin17', 'qipei', 'partslink']

const SELECT_CLS =
  'rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] px-2 py-1 text-sm text-[var(--color-text-secondary,#c7c7cc)] focus:outline-none'

export default function SearchAnalyticsTab() {
  const [days, setDays] = useState(30)
  const [portal, setPortal] = useState('')
  const [gate, setGate] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [data, setData] = useState<PartsBotMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    const url = `/api/admin/search-analytics?view=partsbot&days=${days}` +
      (portal ? `&portal=${encodeURIComponent(portal)}` : '') +
      (gate ? `&gate=${encodeURIComponent(gate)}` : '')
    fetch(url)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || r.status)))
      .then(j => { if (!cancelled) setData(j.metrics) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days, portal, gate, refreshKey])

  const prev = data?.prev

  return (
    <div className="space-y-6">
      {/* S0. Control strip */}
      {/* top-14 clears the app's sticky TopBar (h-14, z-30) — at top-0 this
          strip pinned correctly but sat underneath it and looked broken. */}
      <div className="sticky top-14 z-20 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)]/70 px-6 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-tertiary,#8a8a90)]">Period:</span>
          {DAY_OPTIONS.map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${d === days
                ? 'bg-primary text-primary-foreground'
                : 'border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] text-[var(--color-text-secondary,#c7c7cc)]'}`}>
              {d}d
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">Portal</label>
          <select className={SELECT_CLS} value={portal} onChange={e => setPortal(e.target.value)}>
            {PORTAL_OPTIONS.map(p => (
              <option key={p || 'all'} value={p}>{p === '' ? 'All' : p}</option>
            ))}
          </select>
          <label className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">Gate</label>
          <select className={SELECT_CLS} value={gate} onChange={e => setGate(e.target.value)}>
            {GATE_OPTIONS.map(g => (
              <option key={g || 'all'} value={g}>{g === '' ? 'All' : g}</option>
            ))}
          </select>
          <span className="ml-1 flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary,#8a8a90)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Live
          </span>
          <button onClick={() => setRefreshKey(k => k + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-xs text-[var(--color-text-secondary,#c7c7cc)] hover:bg-white/5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <span>Error: {error}</span>
          <button onClick={() => setRefreshKey(k => k + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs hover:bg-red-500/10">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {loading && <SkeletonDashboard />}

      {data && !loading && data.total === 0 && (
        <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] p-10 text-center">
          <p className="text-sm text-[var(--color-text-secondary,#c7c7cc)]">No bot activity in this period.</p>
          <button onClick={() => setDays(90)}
            className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">
            Try 90 days
          </button>
        </div>
      )}

      {data && !loading && data.total > 0 && prev && (
        <>
          {/* S1. Hero KPI row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <AdminStatCard compact title="Searches" value={data.total} color="blue"
              icon={<Search className="h-5 w-5" />}
              subtitle={`${data.uniqueUsers} users`} />
            <AdminStatCard compact title="Not found" value={`${data.notFoundRate}%`} color="red"
              icon={<XCircle className="h-5 w-5" />} progress={data.notFoundRate}
              subtitle={`${data.notFound} searches`} />
            <AdminStatCard compact title="Out of stock" value={`${data.oosRate}%`} color="yellow"
              icon={<PackageX className="h-5 w-5" />} progress={data.oosRate}
              subtitle={`${data.oos} found-but-OOS`} />
            <AdminStatCard compact title="In stock" value={`${data.inStockRate}%`} color="green"
              icon={<CheckCircle2 className="h-5 w-5" />} progress={data.inStockRate}
              subtitle={`${data.inStock} fulfilled`} />
            <AdminStatCard compact title="Deterministic nav" value={`${data.pgCoverage}%`} color="indigo"
              icon={<Cpu className="h-5 w-5" />} progress={data.pgCoverage}
              subtitle={`${data.pg}/${data.total} via flow decision`} />
            <AdminStatCard compact title="p95 latency" value={`${data.p95}ms`} color="purple"
              icon={<Gauge className="h-5 w-5" />}
              subtitle={`median ${data.p50}ms`} />
          </div>

          {/* delta strip */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs text-[var(--color-text-tertiary,#8a8a90)]">
            <span className="flex items-center gap-1">searches <Delta v={data.total - prev.total} good="up" /></span>
            <span className="flex items-center gap-1">not found <Delta pp good="down" cur={data.notFoundRate} prev={prev.notFoundRate} /></span>
            <span className="flex items-center gap-1">OOS <Delta pp good="down" cur={data.oosRate} prev={prev.oosRate} /></span>
            <span className="flex items-center gap-1">in stock <Delta pp good="up" cur={data.inStockRate} prev={prev.inStockRate} /></span>
            <span className="flex items-center gap-1">deterministic <Delta pp good="up" cur={data.pgCoverage} prev={prev.pgCoverage} /></span>
            <span className="flex items-center gap-1">p95 <Delta pp good="down" cur={data.p95} prev={prev.p95} suffix="ms" /></span>
            <span className="text-[10px] uppercase tracking-wide opacity-60">vs previous {days}d</span>
          </div>

          {/* S1b. LLM router — intent classification */}
          <Panel title="LLM router" subtitle="intent classification of incoming messages"
            icon={<Cpu className="h-4 w-4" />}>
            <IntentBreakdown data={data.byIntent} />
          </Panel>

          {/* S2 + S2b. Outcome trend + portal bars */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Outcome trend" subtitle="100%-stacked daily outcomes + deterministic-nav coverage"
              icon={<Activity className="h-4 w-4" />} className="lg:col-span-2">
              {data.daily.length > 0 ? (
                <OutcomeTrendChart daily={data.daily} />
              ) : (
                <p className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">— no daily data in range —</p>
              )}
            </Panel>
            <Panel title="Which portal is dragging us down" subtitle="volume + not-found rate per lambda">
              <PortalBars data={data.byLambda} />
            </Panel>
          </div>

          {/* S3. Determinism + schema instability */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Navigation determinism" subtitle="flow-decision source split">
              <CoverageDonut data={data.byFlowSource} pct={data.pgCoverage} />
            </Panel>
            <Panel title="Schema instability" subtitle="same query → different schema" icon={<Shuffle className="h-4 w-4" />}>
              {data.schemaFlips.length === 0 ? (
                <p className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">— none — navigation is stable for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {data.schemaFlips.map((f, i) => (
                        <tr key={i} className="border-t border-[var(--color-border-default)] first:border-t-0">
                          <td className="py-1.5 pr-2">
                            <span dir="ltr" className="font-mono text-xs text-[var(--color-text-primary,#e7e7ea)]">{f.query}</span>
                          </td>
                          <td className="py-1.5 pr-2">
                            <span className="rounded-md px-1.5 py-0.5 text-xs font-medium"
                              style={{ background: `rgba(245,158,11,${Math.min(0.1 + f.n * 0.12, 0.45)})`, color: '#fbbf24' }}>
                              {f.n} schemas
                            </span>
                          </td>
                          <td className="py-1.5 pr-2">
                            <span dir="ltr" className="font-mono text-[11px] text-[var(--color-text-tertiary,#8a8a90)]">{f.schemas.join(' | ')}</span>
                          </td>
                          <td className="py-1.5 text-right">
                            <Link href={`/chat/flow-decisions?source=learned&q=${encodeURIComponent(f.query)}`}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-500/10">
                              <Pin className="h-3 w-3" /> Pin schema
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          {/* S4. Fix queue */}
          <Panel title="Fix queue" subtitle="ranked failures — not-found, out-of-stock, and schema flips merged"
            icon={<XCircle className="h-4 w-4" />}>
            <FixQueue notFound={data.topNotFound} oos={data.topOOS} schemaFlips={data.schemaFlips} />
          </Panel>

          {/* S5. Learning loop */}
          <Panel title="Learning loop">
            <LearningLoopStrip total={data.learnedPinsTotal} addedInRange={data.learnedPinsAddedInRange} daily={data.learnedPinsDaily} />
          </Panel>
        </>
      )}
    </div>
  )
}
