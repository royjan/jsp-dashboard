'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, X, Target } from 'lucide-react'
import { FlowCandidate } from './CandidateScoreCard'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

interface VehicleData {
  year?: number
  model?: string
  fuelType?: string
  engineModel?: string
}

interface CandidatesTableProps {
  candidates: (FlowCandidate & { isSelected?: boolean })[]
  vehicleData?: VehicleData
}

type SortKey = 'status' | 'category' | 'subcategory' | 'schema' | 'score'
type StatusKey = 'selected' | 'full' | 'rejected' | 'generic'
type StatusFilter = 'all' | StatusKey

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All statuses',
  selected: 'Selected',
  full: 'Full match',
  rejected: 'Rejected / Partial',
  generic: 'Generic',
}
// Lower = better, used when sorting by status.
const STATUS_ORDER: Record<StatusKey, number> = { selected: 0, full: 1, generic: 2, rejected: 3 }

/** One candidate plus everything derived from it, computed once per render. */
interface Row {
  c: FlowCandidate & { isSelected?: boolean }
  originalIndex: number
  percentage: number
  status: StatusKey
  /** Per-filter pass/fail against the vehicle, undefined where the filter is unset. */
  filterMatches: {
    year?: boolean
    model?: boolean
    fuelType?: boolean
    engineModel?: boolean
  }
}

const matchIcon = (matched?: boolean) =>
  matched === undefined ? null : matched ? (
    <Check className="inline h-3.5 w-3.5 text-emerald-500" />
  ) : (
    <X className="inline h-3.5 w-3.5 text-destructive" />
  )

const scoreColor = (percentage: number, filterCount: number) => {
  if (filterCount === 0) return 'text-muted-foreground'
  if (percentage === 100) return 'text-emerald-600 dark:text-emerald-400 font-bold'
  if (percentage >= 75) return 'text-orange-600 dark:text-orange-400'
  if (percentage >= 50) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}
const progressBarColor = (percentage: number, filterCount: number) => {
  if (filterCount === 0) return 'bg-muted-foreground/40'
  if (percentage === 100) return 'bg-emerald-500'
  if (percentage >= 75) return 'bg-orange-500'
  if (percentage >= 50) return 'bg-red-500'
  return 'bg-muted-foreground/40'
}

const statusOf = (isSelected: boolean, percentage: number, filterCount: number): StatusKey => {
  if (filterCount === 0) return 'generic'
  if (percentage === 100) return isSelected ? 'selected' : 'full'
  return 'rejected'
}

function statusBadge(status: StatusKey, matchScore: number, filterCount: number) {
  const base = 'inline-block px-2 py-1 text-xs rounded font-medium'
  if (status === 'generic')
    return <span className={`${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`}>GENERIC - Fallback</span>
  if (status === 'selected')
    return <span className={`${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`}>SELECTED - Full match</span>
  if (status === 'full')
    return <span className={`${base} bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300`}>FULL MATCH - Lower specificity</span>
  return <span className={`${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`}>REJECTED - Partial ({matchScore}/{filterCount})</span>
}

/** Does this candidate's filter set actually match the vehicle we looked up? */
function computeMatches(c: FlowCandidate, vehicle: VehicleData): Row['filterMatches'] {
  const f = c.filters
  const out: Row['filterMatches'] = {}
  if (f?.yearFrom !== null || f?.yearTo !== null) {
    const from = f?.yearFrom || -Infinity
    const to = f?.yearTo || Infinity
    out.year = vehicle.year ? vehicle.year >= from && vehicle.year <= to : false
  }
  if (f?.model) {
    out.model = vehicle.model ? f.model.toLowerCase() === vehicle.model.toLowerCase() : false
  }
  if (f?.fuelType) {
    out.fuelType = vehicle.fuelType ? f.fuelType.toLowerCase() === vehicle.fuelType.toLowerCase() : false
  }
  if (f?.engineModel) {
    if (vehicle.engineModel) {
      // The stored pattern is glob-ish (`*`/`?`), not a regex — translate it.
      const pattern = f.engineModel.replace(/\*/g, '.*').replace(/\?/g, '.')
      out.engineModel = new RegExp(`^${pattern}$`, 'i').test(vehicle.engineModel)
    } else {
      out.engineModel = false
    }
  }
  return out
}

function buildColumns(vehicle: VehicleData): DataTableColumn<Row, SortKey>[] {
  return [
    {
      key: 'rank',
      header: '#',
      cell: (_r, i) => <span className="text-sm font-bold">#{i + 1}</span>,
      exportValue: (_r, i) => i + 1,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortKey: 'status',
      // STATUS_ORDER is "lower = better", so ascending puts the selected rule first.
      sortValue: r => STATUS_ORDER[r.status],
      cell: r => (
        <div className="flex items-center gap-1">
          {r.c.isSelected && <Target className="h-4 w-4 text-primary" aria-label="Selected" />}
          {statusBadge(r.status, r.c.matchScore, r.c.filterCount)}
        </div>
      ),
      exportValue: r => r.status,
    },
    {
      key: 'flowId',
      header: 'Flow ID',
      hideOnMobile: true,
      cell: r => <span className="font-mono text-xs text-muted-foreground">{r.c.id.substring(0, 8)}</span>,
      exportValue: r => r.c.id,
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      sortKey: 'category',
      sortValue: r => r.c.category || '',
      cell: r => (
        <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          {r.c.category}
        </span>
      ),
      exportValue: r => r.c.category,
    },
    {
      key: 'subcategory',
      header: 'Subcategory',
      sortable: true,
      sortKey: 'subcategory',
      sortValue: r => r.c.subcategory || '',
      cell: r => (
        <span className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
          {r.c.subcategory}
        </span>
      ),
      exportValue: r => r.c.subcategory,
    },
    {
      key: 'schema',
      header: 'Schema',
      sortable: true,
      sortKey: 'schema',
      sortValue: r => r.c.schema || '',
      cell: r => (
        <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          {r.c.schema}
        </span>
      ),
      exportValue: r => r.c.schema,
    },
    {
      key: 'score',
      header: 'Score',
      sortable: true,
      sortKey: 'score',
      // Ties broken by filterCount so a 100% on four filters outranks a 100%
      // on one — the more specific rule is the better candidate.
      sortValue: r => r.percentage * 1000 + r.c.filterCount,
      cell: r => (
        <div className="flex flex-col gap-1">
          <span className={`text-sm font-bold ${scoreColor(r.percentage, r.c.filterCount)}`}>
            {r.c.matchScore}/{r.c.filterCount}
          </span>
          <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${progressBarColor(r.percentage, r.c.filterCount)} transition-all`}
              style={{ width: `${r.percentage}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{r.percentage}%</span>
        </div>
      ),
      exportValue: r => r.percentage,
    },
    {
      key: 'filters',
      header: 'Filter Conditions',
      hideOnMobile: true,
      cell: r => {
        const f = r.c.filters
        if (r.c.filterCount === 0) {
          return <span className="text-xs italic text-muted-foreground">No filters (Generic)</span>
        }
        const line = (label: string, value: React.ReactNode, actual?: string | number, ok?: boolean) => (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{label}: {value}</span>
            {actual !== undefined && actual !== null && actual !== '' && (
              <span className="ms-2">
                <span className="text-muted-foreground">({actual})</span> {matchIcon(ok)}
              </span>
            )}
          </div>
        )
        return (
          <div className="space-y-1 text-xs">
            {(f?.yearFrom !== null || f?.yearTo !== null) &&
              line('Year', `${f?.yearFrom || '∞'}-${f?.yearTo || '∞'}`, vehicle.year, r.filterMatches.year)}
            {f?.model && line('Model', f.model, vehicle.model, r.filterMatches.model)}
            {f?.fuelType && line('Fuel', f.fuelType, vehicle.fuelType, r.filterMatches.fuelType)}
            {f?.engineModel && line('Engine', f.engineModel, vehicle.engineModel, r.filterMatches.engineModel)}
          </div>
        )
      },
      exportValue: null,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: r => (
        <Link href={`/chat/flow-decisions/edit/${r.c.id}`} className="text-sm font-medium text-primary hover:underline">
          Edit →
        </Link>
      ),
      exportValue: null,
    },
  ]
}

export default function CandidatesTable({ candidates, vehicleData = {} }: CandidatesTableProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const columns = useMemo(() => buildColumns(vehicleData), [vehicleData])

  // Decorate once, then filter. Sorting is the table's job.
  const rows = useMemo<Row[]>(() => {
    const decorated = candidates.map((c, i) => {
      const percentage = c.filterCount > 0 ? Math.round((c.matchScore / c.filterCount) * 100) : 0
      return {
        c,
        originalIndex: i,
        percentage,
        status: statusOf(c.isSelected || false, percentage, c.filterCount),
        filterMatches: computeMatches(c, vehicleData),
      }
    })
    return statusFilter === 'all' ? decorated : decorated.filter(r => r.status === statusFilter)
  }, [candidates, statusFilter, vehicleData])

  return (
    <DataTable<Row, SortKey>
      rows={rows}
      columns={columns}
      getRowKey={r => r.c.id}
      defaultSort={{ field: 'score', dir: 'desc' }}
      minWidth="min-w-[1000px]"
      exportFileName="flow-candidates"
      // The selected rule is the answer to "why did the bot pick this one",
      // so it stays marked no matter where the sort puts it.
      rowClassName={r =>
        /* An inset rule rather than a thick inline-start border. A border on a
           table row is part of the box, so the selected row's cells shifted four
           pixels out of line with every other row's — the mark moved the thing it
           was marking. */
        r.c.isSelected
          ? 'bg-emerald-50 dark:bg-emerald-900/20 shadow-[inset_3px_0_0_var(--color-emerald-500)]'
          : undefined
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filter status:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-border bg-input px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {(Object.keys(STATUS_LABELS) as StatusFilter[]).map(s => (
              <option key={s} value={s} className="bg-popover">{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <span className="text-muted-foreground">{rows.length} of {candidates.length}</span>
        </div>
      }
      labels={{ empty: 'No candidates match this status filter.' }}
      mobileCard={{
        title: r => r.c.schema,
        subtitle: r => `${r.c.category} › ${r.c.subcategory}`,
        accent: r => `${r.c.matchScore}/${r.c.filterCount}`,
      }}
    />
  )
}
