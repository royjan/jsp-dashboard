'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Plus, Download, ScanSearch, Map, FlaskConical } from 'lucide-react'
import { useFlowDecisions } from '@/lib/chat-admin/use-flow-decisions'
import type { FlowDecisionRecord } from '@/types/chat-admin/flow-decision'
import { RulesTable } from './RulesTable'
import { RuleFilterBar, type RuleFilters } from './RuleFilterBar'
import { RuleEditorPanel } from './RuleEditorPanel'
import CreateFlowWizard from './CreateFlowWizard'
import { LiveSimulatorDock } from './LiveSimulatorDock'
import { BulkActionToolbar } from './BulkActionToolbar'
import { RetroScanDrawer } from './RetroScanDrawer'
import { RuleCoverageReport } from './RuleCoverageReport'
import { ExportFlowDecisionsModal } from './ExportFlowDecisionsModal'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'

interface FlowDecisionsPageProps {
  initialEditId?: string
}

// Flow decisions the bot taught itself (a "learned pin" = one of these + a direct part).
const LEARNED_SOURCES = ['schema_ref_correction', 'agent_correction_seed', 'chat_correction']

const EMPTY_FILTERS: RuleFilters = {
  search: '',
  status: [],
  source: 'all',
  lambdaTarget: [],
  yearFrom: '',
  yearTo: '',
  model: '',
  fuelType: '',
  engineModel: '',
  vinPattern: '',
  hasDirectPart: 'any',
  hasVehicleFilters: 'any',
}

export default function FlowDecisionsPage({ initialEditId }: FlowDecisionsPageProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const {
    flowDecisions,
    loading,
    error,
    fetchFlowDecisions,
    deleteFlowDecision,
    updateFlowDecisionStatus,
  } = useFlowDecisions(undefined, 2000)

  const [filters, setFilters] = useState<RuleFilters>(() => readFiltersFromUrl(searchParams))
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(initialEditId ?? null)
  const [creating, setCreating] = useState(false)
  const [seedDescription, setSeedDescription] = useState<string | undefined>(undefined)
  const [retroScanOpen, setRetroScanOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [view, setView] = useState<'rules' | 'coverage'>('rules')

  useEffect(() => {
    writeFiltersToUrl(router, pathname, filters)
  }, [filters, router, pathname])

  const filtered = useMemo(() => filterRules(flowDecisions, filters), [flowDecisions, filters])

  // Keep the selection in sync with what's visible — a bulk action must never
  // operate on rows the user has filtered out (or that were deleted).
  useEffect(() => {
    setSelectedIds(prev => {
      const visible = new Set(filtered.map(r => r.id))
      const next = prev.filter(id => visible.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [filtered])

  const editingRule = useMemo(
    () => (editingId ? flowDecisions.find(r => r.id === editingId) ?? null : null),
    [editingId, flowDecisions]
  )

  const handleRowClick = useCallback((id: string) => {
    setEditingId(id)
    setCreating(false)
  }, [])

  const handleCreate = useCallback(() => {
    setCreating(true)
    setEditingId(null)
    setSeedDescription(undefined)
  }, [])

  const handleEditorClose = useCallback(() => {
    setEditingId(null)
    setCreating(false)
    setSeedDescription(undefined)
  }, [])

  const handleEditorSaved = useCallback(async () => {
    await fetchFlowDecisions(1, 2000, false, true)
    handleEditorClose()
  }, [fetchFlowDecisions, handleEditorClose])

  // Run a bulk action over the selected ids. Uses allSettled so one failure
  // doesn't abort the rest; reports partial success and clears only the ids
  // that actually succeeded so the user can retry the failures.
  const runBulk = useCallback(
    async (verb: string, action: (id: string) => Promise<unknown>) => {
      const ids = selectedIds
      const results = await Promise.allSettled(ids.map(id => action(id)))
      const succeeded = ids.filter((_, i) => results[i].status === 'fulfilled')
      const failed = ids.length - succeeded.length
      if (failed === 0) {
        toast.success(`${verb} ${succeeded.length} rule${succeeded.length === 1 ? '' : 's'}`)
        setSelectedIds([])
      } else {
        results.forEach(r => { if (r.status === 'rejected') logger.error(`Bulk ${verb.toLowerCase()} item failed:`, r.reason) })
        toast.error(`${verb} ${succeeded.length} ok, ${failed} failed`)
        setSelectedIds(ids.filter(id => !succeeded.includes(id)))
      }
    },
    [selectedIds]
  )

  const handleBulkApprove = useCallback(
    () => runBulk('Approved', id => updateFlowDecisionStatus(id, 'approved')),
    [runBulk, updateFlowDecisionStatus]
  )

  const handleBulkReject = useCallback(
    () => runBulk('Rejected', id => updateFlowDecisionStatus(id, 'rejected')),
    [runBulk, updateFlowDecisionStatus]
  )

  const handleBulkDelete = useCallback(async () => {
    if (!confirm(`Delete ${selectedIds.length} rule${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    await runBulk('Deleted', id => deleteFlowDecision(id))
  }, [selectedIds, runBulk, deleteFlowDecision])

  const counts = useMemo(() => ({
    total: flowDecisions.length,
    approved: flowDecisions.filter(r => r.status === 'approved').length,
    suggestions: flowDecisions.filter(r => r.status === 'suggestion').length,
    rejected: flowDecisions.filter(r => r.status === 'rejected').length,
  }), [flowDecisions])

  return (
    <div dir="ltr" className="flex h-full min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="relative sticky top-0 z-30 overflow-hidden border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="relative flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Flow Decisions
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {counts.total} rules · {counts.approved} approved · {counts.suggestions} suggestions · {counts.rejected} rejected
            </p>
          </div>

          {/* Analysis tools — distinct from create/export */}
          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              <ViewTab active={view === 'rules'} onClick={() => setView('rules')} label="Rules" />
              <ViewTab active={view === 'coverage'} onClick={() => setView('coverage')} label="Coverage" />
            </nav>
            <a
              href="/chat/flow-decisions/simulator"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-slate-100"
            >
              <FlaskConical className="h-4 w-4 text-cyan-300" />
              Full simulator
            </a>
          </div>

          {/* Subtle divider between analysis and create/export */}
          <div aria-hidden className="hidden h-8 w-px bg-white/10 sm:block" />

          {/* Create / export */}
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={() => setRetroScanOpen(true)} icon={<ScanSearch className="h-4 w-4" />}>
              Retro-scan
            </ToolbarButton>
            <ToolbarButton onClick={() => setExportOpen(true)} icon={<Download className="h-4 w-4" />}>
              Export
            </ToolbarButton>
            <button
              onClick={handleCreate}
              className="group relative inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground ring-1 ring-inset ring-white/10 transition-colors hover:bg-primary/90"
            >
              <Plus className="relative h-4 w-4" />
              <span className="relative">New rule</span>
            </button>
          </div>
        </div>

        {view === 'rules' && (
          <RuleFilterBar
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(EMPTY_FILTERS)}
          />
        )}
      </header>

      <main className="flex-1 overflow-hidden">
        {view === 'rules' ? (
          <div className="h-full overflow-y-auto px-6 pb-32 pt-4">
            {error && (
              <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            )}
            <RulesTable
              rules={filtered}
              loading={loading}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowClick={handleRowClick}
              activeId={editingId}
            />
          </div>
        ) : (
          <RuleCoverageReport
            existingRules={flowDecisions}
            onSeedRule={(partDescription) => {
              setSeedDescription(partDescription)
              setCreating(true)
              setEditingId(null)
              setView('rules')
            }}
          />
        )}
      </main>

      {selectedIds.length > 0 && (
        <BulkActionToolbar
          count={selectedIds.length}
          onClear={() => setSelectedIds([])}
          onApprove={handleBulkApprove}
          onReject={handleBulkReject}
          onDelete={handleBulkDelete}
        />
      )}

      <LiveSimulatorDock highlightRuleId={editingId} />

      {creating && (
        <CreateFlowWizard
          seedDescription={seedDescription}
          existingRules={flowDecisions}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
        />
      )}

      {editingRule && !creating && (
        <RuleEditorPanel
          rule={editingRule}
          isCreating={false}
          seedDescription={seedDescription}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
          onDeleted={async () => {
            await fetchFlowDecisions(1, 2000, false, true)
            handleEditorClose()
          }}
        />
      )}

      {retroScanOpen && (
        <RetroScanDrawer
          onClose={() => setRetroScanOpen(false)}
          onApplied={async () => {
            await fetchFlowDecisions(1, 2000, false, true)
          }}
        />
      )}

      {exportOpen && (
        <ExportFlowDecisionsModal
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          decisions={filtered.map(toExportShape) as any}
        />
      )}
    </div>
  )
}

// The export modal expects a NESTED shape (decision.flowDecision.*,
// decision.vehicleFilters.*) but our records are flat — adapt them here so the
// export doesn't crash on `decision.flowDecision` being undefined.
function toExportShape(r: FlowDecisionRecord) {
  const hasVehicle =
    r.vehicleYearFrom || r.vehicleYearTo || r.vehicleModel ||
    r.vehicleFuelType || r.vehicleEngineModel || r.vinPattern
  return {
    ...r,
    flowDecision: { category: r.category, subcategory: r.subcategory, schema: r.schema },
    vehicleFilters: hasVehicle
      ? {
          yearFrom: r.vehicleYearFrom ?? null,
          yearTo: r.vehicleYearTo ?? null,
          model: r.vehicleModel ?? null,
          fuelType: r.vehicleFuelType ?? null,
          engineModel: r.vehicleEngineModel ?? null,
          vinPattern: r.vinPattern ?? null,
        }
      : undefined,
  }
}

function ViewTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-white/10 text-slate-100 shadow-sm ring-1 ring-inset ring-white/10'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

function ToolbarButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-slate-100"
    >
      {icon}
      {children}
    </button>
  )
}

function readFiltersFromUrl(params: URLSearchParams): RuleFilters {
  return {
    search: params.get('q') || '',
    status: (params.get('status') || '').split(',').filter(Boolean) as RuleFilters['status'],
    source: (params.get('source') as RuleFilters['source']) || 'all',
    lambdaTarget: (params.get('lambda') || '').split(',').filter(Boolean),
    yearFrom: params.get('yearFrom') || '',
    yearTo: params.get('yearTo') || '',
    model: params.get('model') || '',
    fuelType: params.get('fuel') || '',
    engineModel: params.get('engine') || '',
    vinPattern: params.get('vin') || '',
    hasDirectPart: (params.get('hasDirect') as RuleFilters['hasDirectPart']) || 'any',
    hasVehicleFilters: (params.get('hasVehicle') as RuleFilters['hasVehicleFilters']) || 'any',
  }
}

function writeFiltersToUrl(router: ReturnType<typeof useRouter>, pathname: string, f: RuleFilters) {
  const params = new URLSearchParams()
  if (f.search) params.set('q', f.search)
  if (f.status.length) params.set('status', f.status.join(','))
  if (f.source !== 'all') params.set('source', f.source)
  if (f.lambdaTarget.length) params.set('lambda', f.lambdaTarget.join(','))
  if (f.yearFrom) params.set('yearFrom', f.yearFrom)
  if (f.yearTo) params.set('yearTo', f.yearTo)
  if (f.model) params.set('model', f.model)
  if (f.fuelType) params.set('fuel', f.fuelType)
  if (f.engineModel) params.set('engine', f.engineModel)
  if (f.vinPattern) params.set('vin', f.vinPattern)
  if (f.hasDirectPart !== 'any') params.set('hasDirect', f.hasDirectPart)
  if (f.hasVehicleFilters !== 'any') params.set('hasVehicle', f.hasVehicleFilters)
  const qs = params.toString()
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
}

function filterRules(rules: FlowDecisionRecord[], f: RuleFilters): FlowDecisionRecord[] {
  const search = f.search.trim().toLowerCase()
  return rules.filter(r => {
    if (search) {
      const hay = `${r.partDescription} ${r.category} ${r.subcategory} ${r.schema} ${r.lambdaTarget}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    if (f.status.length && !f.status.includes(r.status)) return false
    if (f.source !== 'all') {
      const isLearned = LEARNED_SOURCES.includes(r.source ?? '')
      if (f.source === 'learned' && !isLearned) return false
      if (f.source === 'manual' && isLearned) return false
    }
    if (f.lambdaTarget.length && !f.lambdaTarget.includes(r.lambdaTarget)) return false
    // Year filter = overlap test against the rule's [vehicleYearFrom, vehicleYearTo]
    // range. A null bound means open-ended, so it must NOT exclude the rule.
    // (Previously this used a "contained-within" test that wrongly dropped any
    // rule whose range merely overlapped the query, plus all open-ended rules.)
    if (f.yearFrom) {
      const y = parseInt(f.yearFrom)
      if (!isNaN(y) && r.vehicleYearTo != null && r.vehicleYearTo < y) return false
    }
    if (f.yearTo) {
      const y = parseInt(f.yearTo)
      if (!isNaN(y) && r.vehicleYearFrom != null && r.vehicleYearFrom > y) return false
    }
    if (f.model) {
      if (!r.vehicleModel?.toLowerCase().includes(f.model.toLowerCase())) return false
    }
    if (f.fuelType) {
      if (r.vehicleFuelType?.toLowerCase() !== f.fuelType.toLowerCase()) return false
    }
    if (f.engineModel) {
      if (!r.vehicleEngineModel?.toLowerCase().includes(f.engineModel.toLowerCase())) return false
    }
    if (f.vinPattern) {
      if (!r.vinPattern?.toLowerCase().includes(f.vinPattern.toLowerCase())) return false
    }
    if (f.hasVehicleFilters !== 'any') {
      const hasFilters = Boolean(
        r.vehicleYearFrom || r.vehicleYearTo || r.vehicleModel || r.vehicleFuelType || r.vehicleEngineModel || r.vinPattern
      )
      if (f.hasVehicleFilters === 'yes' && !hasFilters) return false
      if (f.hasVehicleFilters === 'no' && hasFilters) return false
    }
    if (f.hasDirectPart !== 'any') {
      const hasDirect = Boolean((r as any).directPart)
      if (f.hasDirectPart === 'yes' && !hasDirect) return false
      if (f.hasDirectPart === 'no' && hasDirect) return false
    }
    return true
  })
}
