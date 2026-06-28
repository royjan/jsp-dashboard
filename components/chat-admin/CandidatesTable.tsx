'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { FlowCandidate } from './CandidateScoreCard'

interface CandidatesTableProps {
  candidates: (FlowCandidate & { isSelected?: boolean })[]
  vehicleData?: any
}

type SortKey = 'rank' | 'status' | 'category' | 'subcategory' | 'schema' | 'score'
type SortDir = 'asc' | 'desc'
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

export default function CandidatesTable({ candidates, vehicleData = {} }: CandidatesTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const getMatchIcon = (matched?: boolean) => (matched === undefined ? null : matched ? '✅' : '❌')
  const getMatchPercentage = (matchScore: number, filterCount: number) =>
    filterCount > 0 ? Math.round((matchScore / filterCount) * 100) : 0

  const getScoreColor = (percentage: number, filterCount: number) => {
    if (filterCount === 0) return 'text-gray-600 dark:text-gray-400'
    if (percentage === 100) return 'text-green-600 dark:text-green-400 font-bold'
    if (percentage >= 75) return 'text-orange-600 dark:text-orange-400'
    if (percentage >= 50) return 'text-red-600 dark:text-red-400'
    return 'text-gray-600 dark:text-gray-400'
  }
  const getProgressBarColor = (percentage: number, filterCount: number) => {
    if (filterCount === 0) return 'bg-gray-400'
    if (percentage === 100) return 'bg-green-500'
    if (percentage >= 75) return 'bg-orange-500'
    if (percentage >= 50) return 'bg-red-500'
    return 'bg-gray-400'
  }

  const statusOf = (isSelected: boolean, percentage: number, filterCount: number): StatusKey => {
    if (filterCount === 0) return 'generic'
    if (percentage === 100) return isSelected ? 'selected' : 'full'
    return 'rejected'
  }

  const getStatusBadge = (status: StatusKey, matchScore: number, filterCount: number) => {
    const base = 'inline-block px-2 py-1 text-xs rounded font-medium'
    if (status === 'generic')
      return <span className={`${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`}>GENERIC - Fallback</span>
    if (status === 'selected')
      return <span className={`${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`}>SELECTED - Full match</span>
    if (status === 'full')
      return <span className={`${base} bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300`}>FULL MATCH - Lower specificity</span>
    return <span className={`${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`}>REJECTED - Partial ({matchScore}/{filterCount})</span>
  }

  // Decorate, filter, then sort.
  const rows = useMemo(() => {
    const decorated = candidates.map((c, i) => {
      const percentage = getMatchPercentage(c.matchScore, c.filterCount)
      const status = statusOf(c.isSelected || false, percentage, c.filterCount)
      return { c, originalIndex: i, percentage, status }
    })
    const filtered = statusFilter === 'all' ? decorated : decorated.filter((r) => r.status === statusFilter)
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: typeof filtered[number], b: typeof filtered[number]) => {
      switch (sortKey) {
        case 'score':
          return (a.percentage - b.percentage || a.c.filterCount - b.c.filterCount) * dir
        case 'status':
          return (STATUS_ORDER[b.status] - STATUS_ORDER[a.status]) * dir // selected first when desc
        case 'category':
          return (a.c.category || '').localeCompare(b.c.category || '') * dir
        case 'subcategory':
          return (a.c.subcategory || '').localeCompare(b.c.subcategory || '') * dir
        case 'schema':
          return (a.c.schema || '').localeCompare(b.c.schema || '') * dir
        default:
          return (a.originalIndex - b.originalIndex) * dir
      }
    }
    return [...filtered].sort(cmp)
  }, [candidates, statusFilter, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'category' || key === 'subcategory' || key === 'schema' ? 'asc' : 'desc')
    }
  }

  const SortHeader = ({ label, k, className = '' }: { label: string; k?: SortKey; className?: string }) => (
    <th className={`px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap ${className}`}>
      {k ? (
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white"
        >
          {label}
          {sortKey === k ? (
            sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
      ) : (
        label
      )}
    </th>
  )

  return (
    <div className="space-y-3">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500 dark:text-slate-400">Filter status:</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
        >
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
            <option key={s} value={s} className="bg-white dark:bg-slate-800">
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="text-gray-500 dark:text-slate-400">
          {rows.length} of {candidates.length}
        </span>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto border border-gray-300 dark:border-gray-700 rounded-lg">
        <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <SortHeader label="#" />
              <SortHeader label="Status" k="status" />
              <SortHeader label="Flow ID" />
              <SortHeader label="Category" k="category" />
              <SortHeader label="Subcategory" k="subcategory" />
              <SortHeader label="Schema" k="schema" />
              <SortHeader label="Score" k="score" />
              <SortHeader label="Filter Conditions" />
              <SortHeader label="Actions" />
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
                  No candidates match this status filter.
                </td>
              </tr>
            ) : (
              rows.map(({ c: candidate, percentage: matchPercentage, status }, index) => {
                const scoreColor = getScoreColor(matchPercentage, candidate.filterCount)
                const progressBarColor = getProgressBarColor(matchPercentage, candidate.filterCount)
                const isSelected = candidate.isSelected || false

                const filterMatches: any = {}
                if (candidate.filters?.yearFrom !== null || candidate.filters?.yearTo !== null) {
                  const yearFrom = candidate.filters?.yearFrom || -Infinity
                  const yearTo = candidate.filters?.yearTo || Infinity
                  filterMatches.year = vehicleData.year ? vehicleData.year >= yearFrom && vehicleData.year <= yearTo : false
                }
                if (candidate.filters?.model) {
                  filterMatches.model = vehicleData.model
                    ? candidate.filters?.model.toLowerCase() === vehicleData.model.toLowerCase()
                    : false
                }
                if (candidate.filters?.fuelType) {
                  filterMatches.fuelType = vehicleData.fuelType
                    ? candidate.filters?.fuelType.toLowerCase() === vehicleData.fuelType.toLowerCase()
                    : false
                }
                if (candidate.filters?.engineModel) {
                  if (vehicleData.engineModel) {
                    const pattern = candidate.filters?.engineModel.replace(/\*/g, '.*').replace(/\?/g, '.')
                    const regex = new RegExp(`^${pattern}$`, 'i')
                    filterMatches.engineModel = regex.test(vehicleData.engineModel)
                  } else {
                    filterMatches.engineModel = false
                  }
                }

                return (
                  <tr
                    key={candidate.id}
                    className={`${isSelected ? 'bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500' : 'hover:bg-gray-50 dark:hover:bg-gray-700'} transition-colors`}
                  >
                    <td className="px-3 py-4 whitespace-nowrap">
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">#{index + 1}</span>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {isSelected && <span className="text-lg" title="Selected">🎯</span>}
                        {getStatusBadge(status, candidate.matchScore, candidate.filterCount)}
                      </div>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-400">{candidate.id.substring(0, 8)}</span>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                        {candidate.category}
                      </span>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-xs font-medium">
                        {candidate.subcategory}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span className="px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs font-medium whitespace-nowrap">
                        {candidate.schema}
                      </span>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className={`text-sm font-bold ${scoreColor}`}>
                          {candidate.matchScore}/{candidate.filterCount}
                        </span>
                        <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-full ${progressBarColor} transition-all`} style={{ width: `${matchPercentage}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{matchPercentage}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-xs space-y-1 min-w-[200px]">
                        {candidate.filterCount === 0 ? (
                          <span className="text-gray-500 italic">No filters (Generic)</span>
                        ) : (
                          <>
                            {(candidate.filters?.yearFrom !== null || candidate.filters?.yearTo !== null) && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 dark:text-gray-400">
                                  Year: {candidate.filters?.yearFrom || '∞'}-{candidate.filters?.yearTo || '∞'}
                                </span>
                                {vehicleData.year && (
                                  <span className="ml-2">
                                    <span className="text-gray-500">({vehicleData.year})</span> {getMatchIcon(filterMatches.year)}
                                  </span>
                                )}
                              </div>
                            )}
                            {candidate.filters?.model && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Model: {candidate.filters.model}</span>
                                {vehicleData.model && (
                                  <span className="ml-2">
                                    <span className="text-gray-500">({vehicleData.model})</span> {getMatchIcon(filterMatches.model)}
                                  </span>
                                )}
                              </div>
                            )}
                            {candidate.filters?.fuelType && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Fuel: {candidate.filters.fuelType}</span>
                                {vehicleData.fuelType && (
                                  <span className="ml-2">
                                    <span className="text-gray-500">({vehicleData.fuelType})</span> {getMatchIcon(filterMatches.fuelType)}
                                  </span>
                                )}
                              </div>
                            )}
                            {candidate.filters?.engineModel && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Engine: {candidate.filters.engineModel}</span>
                                {vehicleData.engineModel && (
                                  <span className="ml-2">
                                    <span className="text-gray-500">({vehicleData.engineModel})</span> {getMatchIcon(filterMatches.engineModel)}
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-sm">
                      <Link
                        href={`/chat/flow-decisions/edit/${candidate.id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        Edit →
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
