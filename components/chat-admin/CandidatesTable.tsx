'use client'

import React from 'react'
import Link from 'next/link'
import { FlowCandidate } from './CandidateScoreCard'

interface CandidatesTableProps {
  candidates: (FlowCandidate & { isSelected?: boolean })[]
  vehicleData?: any
}

export default function CandidatesTable({
  candidates,
  vehicleData = {}
}: CandidatesTableProps) {
  const getMatchIcon = (matched?: boolean) => {
    if (matched === undefined) return null
    return matched ? '✅' : '❌'
  }

  const getMatchPercentage = (matchScore: number, filterCount: number) => {
    return filterCount > 0 ? Math.round((matchScore / filterCount) * 100) : 0
  }

  const getScoreColor = (percentage: number, filterCount: number) => {
    if (filterCount === 0) return 'text-gray-600 dark:text-gray-400' // Generic
    if (percentage === 100) return 'text-green-600 dark:text-green-400 font-bold' // Perfect match
    if (percentage >= 75) return 'text-orange-600 dark:text-orange-400' // Partial match
    if (percentage >= 50) return 'text-red-600 dark:text-red-400' // Poor match
    return 'text-gray-600 dark:text-gray-400' // Very poor
  }

  const getProgressBarColor = (percentage: number, filterCount: number) => {
    if (filterCount === 0) return 'bg-gray-400' // Generic
    if (percentage === 100) return 'bg-green-500' // Perfect match
    if (percentage >= 75) return 'bg-orange-500' // Partial match
    if (percentage >= 50) return 'bg-red-500' // Poor match
    return 'bg-gray-400' // Very poor
  }

  const getStatusBadge = (isSelected: boolean, percentage: number, filterCount: number, matchScore: number) => {
    if (filterCount === 0) {
      return (
        <span className="inline-block mt-1 px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-xs rounded font-medium">
          GENERIC - Fallback
        </span>
      )
    }

    if (percentage === 100) {
      if (isSelected) {
        return (
          <span className="inline-block mt-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs rounded font-medium">
            SELECTED - Full match
          </span>
        )
      } else {
        return (
          <span className="inline-block mt-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs rounded font-medium">
            FULL MATCH - Lower specificity
          </span>
        )
      }
    } else {
      return (
        <span className="inline-block mt-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-xs rounded font-medium">
          REJECTED - Partial ({matchScore}/{filterCount})
        </span>
      )
    }
  }

  // Sort candidates by score percentage descending (100% → 0%)
  const sortedCandidates = [...candidates].sort((a, b) => {
    const percentageA = getMatchPercentage(a.matchScore, a.filterCount)
    const percentageB = getMatchPercentage(b.matchScore, b.filterCount)

    // First sort by percentage (descending)
    if (percentageB !== percentageA) {
      return percentageB - percentageA
    }

    // If same percentage, sort by filterCount (more specific first)
    return b.filterCount - a.filterCount
  })

  return (
    <div className="overflow-x-auto border border-gray-300 dark:border-gray-700 rounded-lg">
      <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              #
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Status
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Flow ID
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Category
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Subcategory
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Schema
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Score
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Filter Conditions
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          {sortedCandidates.map((candidate, index) => {
            const matchPercentage = getMatchPercentage(candidate.matchScore, candidate.filterCount)
            const scoreColor = getScoreColor(matchPercentage, candidate.filterCount)
            const progressBarColor = getProgressBarColor(matchPercentage, candidate.filterCount)
            const isSelected = candidate.isSelected || false

            // Build filter matches
            const filterMatches: any = {}

            if (candidate.filters?.yearFrom !== null || candidate.filters?.yearTo !== null) {
              const yearFrom = candidate.filters?.yearFrom || -Infinity
              const yearTo = candidate.filters?.yearTo || Infinity
              filterMatches.year = vehicleData.year ? (vehicleData.year >= yearFrom && vehicleData.year <= yearTo) : false
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
                const pattern = candidate.filters?.engineModel
                  .replace(/\*/g, '.*')
                  .replace(/\?/g, '.')
                const regex = new RegExp(`^${pattern}$`, 'i')
                filterMatches.engineModel = regex.test(vehicleData.engineModel)
              } else {
                filterMatches.engineModel = false
              }
            }

            return (
              <tr
                key={candidate.id}
                className={`
                  ${isSelected ? 'bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}
                  transition-colors
                `}
              >
                {/* Rank */}
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    #{index + 1}
                  </span>
                </td>

                {/* Status with Badge */}
                <td className="px-3 py-4 whitespace-nowrap">
                  <div className="flex flex-col items-start gap-1">
                    {isSelected && (
                      <span className="text-2xl" title="Selected">🎯</span>
                    )}
                    {getStatusBadge(isSelected, matchPercentage, candidate.filterCount, candidate.matchScore)}
                  </div>
                </td>

                {/* Flow Decision ID */}
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
                    {candidate.id.substring(0, 8)}
                  </span>
                </td>

                {/* Category */}
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                    {candidate.category}
                  </span>
                </td>

                {/* Subcategory */}
                <td className="px-3 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-xs font-medium">
                    {candidate.subcategory}
                  </span>
                </td>

                {/* Schema */}
                <td className="px-3 py-4">
                  <span className="px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs font-medium">
                    {candidate.schema}
                  </span>
                </td>

                {/* Score */}
                <td className="px-3 py-4 whitespace-nowrap">
                  <div className="flex flex-col gap-1">
                    <span className={`text-sm font-bold ${scoreColor}`}>
                      {candidate.matchScore}/{candidate.filterCount}
                    </span>
                    <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${progressBarColor} transition-all`}
                        style={{ width: `${matchPercentage}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {matchPercentage}%
                    </span>
                  </div>
                </td>

                {/* Filter Conditions */}
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
                            <span className="text-gray-600 dark:text-gray-400">
                              Model: {candidate.filters.model}
                            </span>
                            {vehicleData.model && (
                              <span className="ml-2">
                                <span className="text-gray-500">({vehicleData.model})</span> {getMatchIcon(filterMatches.model)}
                              </span>
                            )}
                          </div>
                        )}
                        {candidate.filters?.fuelType && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Fuel: {candidate.filters.fuelType}
                            </span>
                            {vehicleData.fuelType && (
                              <span className="ml-2">
                                <span className="text-gray-500">({vehicleData.fuelType})</span> {getMatchIcon(filterMatches.fuelType)}
                              </span>
                            )}
                          </div>
                        )}
                        {candidate.filters?.engineModel && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Engine: {candidate.filters.engineModel}
                            </span>
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

                {/* Actions */}
                <td className="px-3 py-4 whitespace-nowrap text-sm">
                  <Link
                    href={`/admin/flow-decisions/edit/${candidate.id}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Edit →
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
