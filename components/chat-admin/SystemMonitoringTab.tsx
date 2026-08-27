'use client'

/**
 * System Monitoring Tab Component
 *
 * Merged view of Lambda service health and search queue monitoring.
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  RefreshCw,
  Activity,
  Clock,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Ban,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  HelpCircle,
  RotateCcw,
  Power
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { copyText } from '@/lib/clipboard'
import { AdminStatCard, StatusBadge } from '@/components/chat-admin/shared'
import type { LambdaType } from '@/lib/chat-admin/queue-config'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

// Lambda Status types
interface LambdaStatus {
  serviceName: 'psa' | 'partslink' | 'vin17' | 'qipei' | 'saic'
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  errorType: string | null
  errorMessage: string | null
  lastSuccess: string | null
  lastFailure: string | null
  consecutiveFailures: number
  isEnabled: boolean
  updatedAt: string
}

// Session/Queue types
interface TrackedSearch {
  id: string
  searchId: string
  userId: string
  userEmail?: string
  conversationId: string
  vin: string
  licensePlate?: string
  parts: string[]
  lambdaType: LambdaType
  status: string
  queuePosition?: number
  estimatedWaitMs?: number
  createdAt: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  partsFound?: number
  errorMessage?: string
}

interface QueueStats {
  byLambdaType: Record<LambdaType, {
    activeCount: number
    queuedCount: number
    maxConcurrent: number
    avgDurationMs: number
  }>
  total: {
    activeCount: number
    queuedCount: number
    completedLast24h: number
    failedLast24h: number
    avgDurationMs: number
    successRate: number
  }
}

// Professional neutral card styling - color is only in the status badge
const LAMBDA_CARD_STYLES = 'bg-card border-border'

// Helper to get partsFound (workaround for Turbopack minification bug)
function getPartsFound(search: TrackedSearch): string {
  const val = search.partsFound
  return val !== undefined && val !== null ? String(val) : '-'
}

// Neutral badge styling for lambda types in tables
const LAMBDA_BADGE_STYLES = 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'

const LAMBDA_NAMES: Record<LambdaType, string> = {
  psa: 'PSA',
  partslink: 'PartsLink',
  vin17: 'VIN17',
  qipei: 'Qipei',
  saic: 'SAIC',
}

const STATUS_CONFIG = {
  healthy: {
    icon: CheckCircle,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    label: 'Healthy'
  },
  degraded: {
    icon: AlertTriangle,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    label: 'Degraded'
  },
  down: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    label: 'Down'
  },
  unknown: {
    icon: HelpCircle,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    label: 'Unknown'
  }
}

const ERROR_LABELS: Record<string, string> = {
  auth_failed: 'Auth Failed',
  billing_depleted: 'Balance Depleted',
  timeout: 'Timeout',
  connection_error: 'Connection Error',
  unknown: 'Unknown Error'
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

function formatTimeAgo(timestamp: number | string | null): string {
  if (!timestamp) return 'Never'

  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return `${diffSecs}s ago`
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function getElapsedTime(startedAt?: number): string {
  if (!startedAt) return '-'
  const elapsed = Date.now() - startedAt
  return formatDuration(elapsed)
}

const ITEMS_PER_PAGE = 10

/** The three tables below all render a user and a parts list the same way. */
const userCell = (s: TrackedSearch) => s.userEmail || s.userId.slice(0, 8)
const partsCell = (s: TrackedSearch) =>
  `${s.parts.slice(0, 2).join(', ')}${s.parts.length > 2 ? ` +${s.parts.length - 2}` : ''}`

function CopyableVin({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (await copyText(vin)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Failed to copy VIN')
    }
  }

  return (
    <div className="group relative inline-flex items-center gap-1">
      <span
        className="font-mono text-slate-300 cursor-pointer hover:text-cyan-300 transition-colors"
        onClick={handleCopy}
        title="Click to copy VIN"
      >
        {vin.length > 10 ? `${vin.slice(0, 10)}...` : vin}
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-700 rounded"
        title="Copy VIN"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3 text-slate-400" />
        )}
      </button>
      <div className="absolute left-0 bottom-full mb-1 z-20 hidden group-hover:block bg-slate-900 border border-slate-700 rounded px-2 py-1 shadow-lg whitespace-nowrap">
        <span className="text-xs font-mono text-slate-200">{vin}</span>
      </div>
    </div>
  )
}

export function SystemMonitoringTab() {
  const router = useRouter()

  // Lambda status state
  const [lambdaStatuses, setLambdaStatuses] = useState<LambdaStatus[]>([])
  const [resettingService, setResettingService] = useState<string | null>(null)
  const [togglingService, setTogglingService] = useState<string | null>(null)
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null)

  // Sessions state
  const [activeSearches, setActiveSearches] = useState<TrackedSearch[]>([])
  const [queuedSearches, setQueuedSearches] = useState<TrackedSearch[]>([])
  const [recentSearches, setRecentSearches] = useState<TrackedSearch[]>([])
  const [stats, setStats] = useState<QueueStats | null>(null)

  // UI state
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async (showRefreshIndicator = false) => {
    try {
      if (showRefreshIndicator) setRefreshing(true)

      const [lambdaRes, sessionsRes, statsRes] = await Promise.all([
        fetch('/api/admin/lambda-status'),
        fetch('/api/admin/sessions'),
        fetch('/api/admin/sessions/stats'),
      ])

      if (lambdaRes.ok) {
        const data = await lambdaRes.json()
        if (data.success && Array.isArray(data.statuses)) {
          setLambdaStatuses(data.statuses)
        }
      }

      if (sessionsRes.ok) {
        const data = await sessionsRes.json()
        setActiveSearches(data.active || [])
        setQueuedSearches(data.queued || [])
        setRecentSearches(data.recent || [])
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json()
        setStats(statsData)
      }
    } catch (error) {
      console.error('Error fetching monitoring data:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => fetchData(), 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const resetService = async (serviceName: string) => {
    try {
      setResettingService(serviceName)
      const response = await fetch('/api/admin/lambda-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName })
      })
      const data = await response.json()
      if (data.success) {
        toast.success(`${serviceName.toUpperCase()} status reset`)
        await fetchData()
      } else {
        toast.error(`Failed to reset: ${data.error}`)
      }
    } catch (error) {
      console.error('Error resetting service:', error)
      toast.error('An error occurred')
    } finally {
      setResettingService(null)
    }
  }

  const toggleLambdaEnabled = async (serviceName: string, currentEnabled: boolean) => {
    // If disabling, show confirmation first
    if (currentEnabled) {
      setConfirmDisable(serviceName)
      return
    }

    await performToggle(serviceName, true)
  }

  const performToggle = async (serviceName: string, enabled: boolean) => {
    try {
      setTogglingService(serviceName)
      setConfirmDisable(null)

      const response = await fetch('/api/admin/lambda-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName, enabled })
      })
      const data = await response.json()

      if (data.success) {
        toast.success(`${LAMBDA_NAMES[serviceName as LambdaType]} ${enabled ? 'enabled' : 'disabled'}`)
        await fetchData()
      } else {
        toast.error(`Failed to toggle: ${data.error}`)
      }
    } catch (error) {
      console.error('Error toggling service:', error)
      toast.error('An error occurred')
    } finally {
      setTogglingService(null)
    }
  }

  const handleCancelSearch = async (searchId: string, force: boolean = false) => {
    try {
      const response = await fetch('/api/admin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', searchId, force }),
      })
      if (response.ok) {
        toast.success(force ? 'Search force cancelled' : 'Search cancelled')
        fetchData()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to cancel search')
      }
    } catch {
      toast.error('Error cancelling search')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    )
  }

  const lambdaTypes: LambdaType[] = ['psa', 'partslink', 'vin17', 'qipei', 'saic']

  return (
    <div className="space-y-8">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Service Health Cards - Merged Lambda Status + Queue Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 items-stretch">
        {lambdaTypes.map((type) => {
          const lambdaStatus = lambdaStatuses.find(s => s.serviceName === type)
          const typeStats = stats?.byLambdaType[type]
          const statusConfig = STATUS_CONFIG[lambdaStatus?.status || 'unknown']
          const StatusIcon = statusConfig.icon
          const isAtCapacity = typeStats && typeStats.activeCount >= typeStats.maxConcurrent
          const errorLabel = lambdaStatus?.errorType
            ? (ERROR_LABELS[lambdaStatus.errorType] || lambdaStatus.errorType)
            : null
          const isEnabled = lambdaStatus?.isEnabled ?? true
          const isToggling = togglingService === type

          return (
            <div
              key={type}
              className={`ltr-card rounded-xl border p-7 min-w-0 ${LAMBDA_CARD_STYLES} transition-all duration-200 hover:shadow-lg hover:shadow-slate-200/50 dark:hover:shadow-slate-900/50 ${!isEnabled ? 'opacity-60' : ''}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4 ltr-card">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-100 truncate">{LAMBDA_NAMES[type]}</h3>
                  {!isEnabled && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded whitespace-nowrap flex-shrink-0">
                      DISABLED
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isAtCapacity && isEnabled && (
                    <StatusBadge status="busy" size="sm" />
                  )}
                  <StatusBadge
                    status={!isEnabled ? 'down' : (lambdaStatus?.status || 'unknown')}
                    size="sm"
                  />
                </div>
              </div>

              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-100 dark:border-slate-700 ltr-card">
                <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">Service</span>
                <button
                  onClick={() => toggleLambdaEnabled(type, isEnabled)}
                  disabled={isToggling}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                    isEnabled
                      ? 'bg-emerald-500 hover:bg-emerald-600'
                      : 'bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500'
                  } ${isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                  title={isEnabled ? 'Click to disable' : 'Click to enable'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                      isEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                  {isToggling && (
                    <Loader2 className="absolute inset-0 m-auto w-3 h-3 animate-spin text-white" />
                  )}
                </button>
              </div>

              {/* Stats Grid - using CSS grid for RTL-safe layout */}
              <div className="text-sm ltr-card" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 16px' }}>
                <span className="text-slate-500 dark:text-slate-400">Active</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-200 text-right">
                  {typeStats?.activeCount || 0} / {typeStats?.maxConcurrent || '-'}
                </span>

                <span className="text-slate-500 dark:text-slate-400">Queued</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-200 text-right">{typeStats?.queuedCount || 0}</span>

                <span className="text-slate-500 dark:text-slate-400">Avg Duration</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-200 text-right">
                  {typeStats ? formatDuration(typeStats.avgDurationMs) : '-'}
                </span>

                {lambdaStatus?.consecutiveFailures ? (
                  <>
                    <span className="text-slate-500 dark:text-slate-400">Failures</span>
                    <span className="font-mono text-red-600 dark:text-red-400 text-right">{lambdaStatus.consecutiveFailures}</span>
                  </>
                ) : null}
                {errorLabel && (
                  <>
                    <span className="text-slate-500 dark:text-slate-400">Error</span>
                    <span className="text-xs text-red-600 dark:text-red-400 text-right truncate" title={lambdaStatus?.errorMessage || ''}>
                      {errorLabel}
                    </span>
                  </>
                )}
              </div>

              {/* Last OK - separated with border */}
              <div className="text-xs pt-4 mt-4 border-t border-slate-100 dark:border-slate-700 ltr-card" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-slate-400 dark:text-slate-500">Last OK</span>
                <span className={lambdaStatus?.lastSuccess ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                  {formatTimeAgo(lambdaStatus?.lastSuccess || null)}
                </span>
              </div>

              {/* Reset Button */}
              {lambdaStatus && lambdaStatus.status !== 'healthy' && lambdaStatus.status !== 'unknown' && (
                <button
                  onClick={() => resetService(type)}
                  disabled={resettingService === type}
                  className="mt-6 w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-600/50 rounded-xl border border-slate-200 dark:border-slate-600 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${resettingService === type ? 'animate-spin' : ''}`} />
                  Reset Status
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <AdminStatCard
          title="Total Active"
          value={stats?.total.activeCount || 0}
          subtitle="Currently processing"
          icon={<Activity className="w-6 h-6" />}
          color="blue"
        />
        <AdminStatCard
          title="Total Queued"
          value={stats?.total.queuedCount || 0}
          subtitle="Waiting in queue"
          icon={<Clock className="w-6 h-6" />}
          color="yellow"
        />
        <AdminStatCard
          title="Completed (24h)"
          value={stats?.total.completedLast24h || 0}
          subtitle="Successfully processed"
          icon={<TrendingUp className="w-6 h-6" />}
          color="green"
        />
        <AdminStatCard
          title="Success Rate"
          value={`${stats?.total.successRate?.toFixed(1) || 100}%`}
          subtitle="Last 24 hours"
          icon={<CheckCircle className="w-6 h-6" />}
          color="purple"
          progress={stats?.total.successRate || 100}
        />
      </div>

      {/* Active Searches Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
            <Loader2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin" />
          </div>
          <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-100">Active Searches ({activeSearches.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <DataTable<TrackedSearch>
            rows={activeSearches}
            columns={[
              { key: 'user', header: 'User', sortable: true, sortValue: userCell, cell: userCell, exportValue: userCell },
              { key: 'vin', header: 'VIN', sortable: true, cell: s => <CopyableVin vin={s.vin} />, exportValue: s => s.vin },
              {
                key: 'lambdaType',
                header: 'Lambda',
                sortable: true,
                cell: s => <span className={`rounded px-2.5 py-1 text-xs ${LAMBDA_BADGE_STYLES}`}>{LAMBDA_NAMES[s.lambdaType]}</span>,
                exportValue: s => LAMBDA_NAMES[s.lambdaType],
              },
              { key: 'parts', header: 'Parts', cell: partsCell, exportValue: s => s.parts.join(', ') },
              {
                key: 'duration',
                header: 'Duration',
                sortable: true,
                // Sort on the START time, not the rendered "4m 12s" string —
                // that sorts "10s" before "4m" and puts the longest-running
                // search, the one you are here to kill, in the middle.
                sortValue: s => s.startedAt,
                cell: s => <span className="font-mono">{getElapsedTime(s.startedAt)}</span>,
                exportValue: s => s.startedAt,
              },
              {
                key: 'actions',
                header: 'Actions',
                cell: s => (
                  <button
                    onClick={() => handleCancelSearch(s.searchId, true)}
                    className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600"
                    title="Force kill search"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                ),
                exportValue: null,
              },
            ] satisfies DataTableColumn<TrackedSearch>[]}
            getRowKey={s => s.searchId}
            minWidth="min-w-[820px]"
            maxHeight="none"
            labels={{ empty: 'No active searches' }}
          />
        </div>
      </div>

      {/* Queued Searches Table */}
      {queuedSearches.length > 0 && (
        <div className="rounded-lg bg-slate-800/30 border border-orange-500/30 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/50 flex items-center gap-3 bg-orange-500/10">
            <Clock className="w-5 h-5 text-orange-400" />
            <h3 className="font-medium text-white text-base">Queue ({queuedSearches.length})</h3>
            <span className="text-sm text-orange-300 ml-2">
              PartsLink bottleneck - only 1 concurrent
            </span>
          </div>
          <div className="overflow-x-auto">
            <DataTable<TrackedSearch>
              rows={queuedSearches}
              columns={[
                {
                  key: 'position',
                  header: 'Position',
                  // The queue IS its order, so position is the row index and the
                  // column is not sortable — sorting it would be a lie.
                  cell: (_s, i) => <span className="font-bold text-orange-400">#{i + 1}</span>,
                  exportValue: (_s, i) => i + 1,
                },
                { key: 'user', header: 'User', cell: userCell, exportValue: userCell },
                { key: 'vin', header: 'VIN', cell: s => <CopyableVin vin={s.vin} />, exportValue: s => s.vin },
                { key: 'parts', header: 'Parts', cell: partsCell, exportValue: s => s.parts.join(', ') },
                {
                  key: 'wait',
                  header: 'Est. Wait',
                  cell: s => `~${formatDuration(s.estimatedWaitMs || 0)}`,
                  exportValue: s => s.estimatedWaitMs || 0,
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  cell: s => (
                    <button
                      onClick={() => handleCancelSearch(s.searchId)}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400"
                      title="Cancel"
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                  ),
                  exportValue: null,
                },
              ] satisfies DataTableColumn<TrackedSearch>[]}
              getRowKey={s => s.searchId}
              minWidth="min-w-[760px]"
              maxHeight="none"
              labels={{ empty: 'Queue is empty' }}
            />
          </div>
        </div>
      )}

      {/* Recent Completed Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-6 py-5">
          <div className="rounded-lg bg-muted p-2.5">
            <CheckCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Recent Completed ({recentSearches.length})</h3>
        </div>
        <DataTable<TrackedSearch>
          rows={recentSearches}
          columns={[
            {
              key: 'time',
              header: 'Time',
              sortable: true,
              // The timestamp, not "4 minutes ago" — the prose sorts wrong and
              // is useless in the export.
              sortValue: s => s.completedAt || s.createdAt,
              cell: s => <span className="text-xs text-muted-foreground">{formatTimeAgo(s.completedAt || s.createdAt)}</span>,
              exportValue: s => s.completedAt || s.createdAt,
            },
            { key: 'user', header: 'User', sortable: true, sortValue: userCell, cell: userCell, exportValue: userCell },
            {
              key: 'licensePlate',
              header: 'License Plate',
              sortable: true,
              cell: s => <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{s.licensePlate || '-'}</span>,
              exportValue: s => s.licensePlate ?? '',
            },
            { key: 'vin', header: 'VIN', sortable: true, cell: s => <span className="text-xs"><CopyableVin vin={s.vin} /></span>, exportValue: s => s.vin },
            {
              key: 'lambdaType',
              header: 'Lambda',
              sortable: true,
              cell: s => <span className={`rounded px-2.5 py-1 text-xs ${LAMBDA_BADGE_STYLES}`}>{LAMBDA_NAMES[s.lambdaType]}</span>,
              exportValue: s => LAMBDA_NAMES[s.lambdaType],
            },
            {
              key: 'durationMs',
              header: 'Duration',
              align: 'end',
              sortable: true,
              sortValue: s => s.durationMs ?? -1,
              cell: s => <span className="font-mono text-xs">{s.durationMs ? formatDuration(s.durationMs) : '-'}</span>,
              exportValue: s => s.durationMs ?? '',
            },
            {
              key: 'status',
              header: 'Status',
              align: 'center',
              sortable: true,
              cell: s =>
                s.status === 'completed' ? (
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                ) : s.status === 'failed' ? (
                  <span title={s.errorMessage || 'Failed'}>
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  </span>
                ) : (
                  <XCircle className="h-5 w-5 text-slate-400" />
                ),
              exportValue: s => s.status,
            },
            {
              key: 'parts',
              header: 'Parts',
              cell: s => (
                <span className="flex items-center gap-2">
                  <span>{getPartsFound(s)}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-cyan-400 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              ),
              exportValue: s => getPartsFound(s),
            },
          ] satisfies DataTableColumn<TrackedSearch>[]}
          getRowKey={s => s.searchId}
          defaultSort={{ field: 'time', dir: 'desc' }}
          pageSize={ITEMS_PER_PAGE}
          minWidth="min-w-[1000px]"
          exportFileName="recent-searches"
          rowClassName={() => 'group'}
          labels={{ empty: 'No recent searches' }}
        />
      </div>

      {/* Confirmation Dialog for Disabling Lambda */}
      {confirmDisable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 max-w-md mx-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                Disable {LAMBDA_NAMES[confirmDisable as LambdaType]}?
              </h3>
            </div>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              This will prevent all searches from using {LAMBDA_NAMES[confirmDisable as LambdaType]}.
              Brands requiring this service will receive errors.
              {confirmDisable === 'partslink' && (
                <span className="block mt-2 text-amber-600 dark:text-amber-400 font-medium">
                  ⚠️ PSA fallback will also be disabled.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDisable(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performToggle(confirmDisable, false)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Disable Service
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SystemMonitoringTab
