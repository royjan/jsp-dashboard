'use client'

import React from 'react'
import Link from 'next/link'

export interface FlowCandidate {
  id: string
  category: string
  subcategory: string
  schema: string
  matchScore: number
  filterCount: number
  mismatchReasons?: string[]
  filters?: {
    yearFrom?: number | null
    yearTo?: number | null
    model?: string | null
    fuelType?: string | null
    engineModel?: string | null
    vinPattern?: string | null
  }
  filterMatches?: {
    year?: boolean
    model?: boolean
    fuelType?: boolean
    engineModel?: boolean
    vinPattern?: boolean
  }
}

interface CandidateScoreCardProps {
  candidate: FlowCandidate
  rank: number
  isSelected?: boolean
  vehicleData?: any
}

export default function CandidateScoreCard({
  candidate,
  rank,
  isSelected = false,
  vehicleData = {}
}: CandidateScoreCardProps) {
  const matchPercentage = candidate.filterCount > 0
    ? Math.round((candidate.matchScore / candidate.filterCount) * 100)
    : 0

  const getMatchIcon = (matched?: boolean) => {
    if (matched === undefined) return null
    return matched ? '✅' : '❌'
  }

  const getEngineMatchType = () => {
    if (!candidate.filters?.engineModel || !vehicleData.engineModel) return null

    const filterEngine = candidate.filters.engineModel

    // Check if it's a wildcard pattern
    const hasWildcard = filterEngine.includes('*') || filterEngine.includes('?')

    if (hasWildcard) {
      return candidate.filterMatches?.engineModel ? '✅ Wildcard' : '❌'
    }

    return candidate.filterMatches?.engineModel ? '✅ Exact' : '❌'
  }

  return (
    <div className={`
      relative rounded-xl border-2 p-6 transition-all
      ${isSelected
        ? 'border-green-500 bg-green-50 dark:bg-green-900/20 shadow-lg'
        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-blue-400'
      }
    `}>
      {/* Rank Badge */}
      <div className={`
        absolute -top-3 -left-3 w-8 h-8 rounded-full flex items-center justify-center
        text-sm font-bold shadow-lg
        ${isSelected
          ? 'bg-green-500 text-white'
          : 'bg-blue-500 text-white'
        }
      `}>
        #{rank}
      </div>

      {/* Selected Badge */}
      {isSelected && (
        <div className="absolute -top-3 -right-3 px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full shadow-lg">
          SELECTED
        </div>
      )}

      {/* Flow Path */}
      <div className="mb-6 pt-2">
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-2">
          <span className="font-semibold">Flow Path:</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium">
            {candidate.category}
          </span>
          <span className="text-slate-400">→</span>
          <span className="px-3 py-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium">
            {candidate.subcategory}
          </span>
          <span className="text-slate-400">→</span>
          <span className="px-3 py-1.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg text-sm font-medium">
            {candidate.schema}
          </span>
        </div>
      </div>

      {/* Match Score */}
      <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Match Score:
          </span>
          <span className={`text-lg font-bold ${
            matchPercentage >= 75 ? 'text-green-600 dark:text-green-400' :
            matchPercentage >= 50 ? 'text-yellow-600 dark:text-yellow-400' :
            'text-red-600 dark:text-red-400'
          }`}>
            {candidate.matchScore}/{candidate.filterCount} = {matchPercentage}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              matchPercentage >= 75 ? 'bg-green-500' :
              matchPercentage >= 50 ? 'bg-yellow-500' :
              'bg-red-500'
            }`}
            style={{ width: `${matchPercentage}%` }}
          />
        </div>
      </div>

      {/* Filter Conditions */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">
          Filter Conditions:
        </h4>

        {/* Year Range */}
        {(candidate.filters?.yearFrom !== null || candidate.filters?.yearTo !== null) && (
          <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">Year Range:</span> {candidate.filters?.yearFrom || '∞'} - {candidate.filters?.yearTo || '∞'}
            </span>
            <div className="flex items-center gap-2">
              {vehicleData.year && (
                <span className="text-xs text-slate-500">({vehicleData.year})</span>
              )}
              <span className="text-lg">{getMatchIcon(candidate.filterMatches?.year)}</span>
            </div>
          </div>
        )}

        {/* Fuel Type */}
        {candidate.filters?.fuelType && (
          <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">Fuel Type:</span> {candidate.filters.fuelType}
            </span>
            <div className="flex items-center gap-2">
              {vehicleData.fuelType && (
                <span className="text-xs text-slate-500">({vehicleData.fuelType})</span>
              )}
              <span className="text-lg">{getMatchIcon(candidate.filterMatches?.fuelType)}</span>
            </div>
          </div>
        )}

        {/* Engine Model */}
        {candidate.filters?.engineModel && (
          <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">Engine Model:</span> {candidate.filters.engineModel}
            </span>
            <div className="flex items-center gap-2">
              {vehicleData.engineModel && (
                <span className="text-xs text-slate-500">({vehicleData.engineModel})</span>
              )}
              <span className="text-sm font-medium">{getEngineMatchType()}</span>
            </div>
          </div>
        )}

        {/* Vehicle Model */}
        {candidate.filters?.model && (
          <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">Vehicle Model:</span> {candidate.filters.model}
            </span>
            <div className="flex items-center gap-2">
              {vehicleData.model && (
                <span className="text-xs text-slate-500">({vehicleData.model})</span>
              )}
              <span className="text-lg">{getMatchIcon(candidate.filterMatches?.model)}</span>
            </div>
          </div>
        )}

        {/* VIN Pattern */}
        {candidate.filters?.vinPattern && (
          <div className="flex items-center justify-between text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-900/30">
            <span className="text-slate-600 dark:text-slate-400">
              <span className="font-medium">VIN Pattern:</span> <code className="text-xs bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">{candidate.filters.vinPattern}</code>
            </span>
            <div className="flex items-center gap-2">
              {vehicleData.vin && (
                <span className="text-xs text-slate-500">({vehicleData.vin.substring(0, 8)}...)</span>
              )}
              <span className="text-lg">{getMatchIcon(candidate.filterMatches?.vinPattern)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Mismatch Reasons */}
      {candidate.mismatchReasons && candidate.mismatchReasons.length > 0 && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <h5 className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
            Mismatch Reasons:
          </h5>
          <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
            {candidate.mismatchReasons.map((reason, idx) => (
              <li key={idx}>• {reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Edit Link */}
      <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
        <Link
          href={`/chat/flow-decisions/edit/${candidate.id}`}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
        >
          Edit Flow Decision →
        </Link>
      </div>
    </div>
  )
}
