'use client'

import React from 'react'
import { Search, AlertTriangle, Target, AlertCircle, Loader2 } from 'lucide-react'
import CandidateScoreCard, { FlowCandidate } from './CandidateScoreCard'
import CandidatesTable from './CandidatesTable'

interface SimulatorResultsProps {
  results: {
    success: boolean
    partDescription: string
    vehicleData: any
    bestMatch: {
      id: string
      category: string
      subcategory: string
      schema: string
      confidence: number
      reasoning: string
      filters: any
    } | null
    allCandidates: any[]
    matchType: string
    timestamp: string
    translationUsed?: boolean
    searchedTerm?: string
  } | null
  loading?: boolean
  error?: string
}

export default function SimulatorResults({
  results,
  loading = false,
  error
}: SimulatorResultsProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20">
        <Loader2 className="h-12 w-12 animate-spin text-cyan-400" />
        <p className="mt-6 text-base font-medium text-slate-200">
          Simulating flow decision matching...
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Analyzing all candidates and scoring matches
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-400/30 bg-rose-500/15 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-rose-300" />
          <div className="flex-1">
            <h3 className="mb-2 text-base font-semibold text-rose-200">
              Simulation Error
            </h3>
            <p className="text-sm text-rose-300/90">
              {error}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Search className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-slate-200">
          Flow Decision Simulator
        </h3>
        <p className="max-w-md text-sm text-slate-400">
          Enter a part description and vehicle information, then click &quot;Simulate&quot; to see how flow decisions would be matched and scored.
        </p>
      </div>
    )
  }

  const candidatesWithScoring: FlowCandidate[] = results.allCandidates.map((candidate: any) => {
    // Build filter matches object
    const filterMatches: any = {}
    const vehicleData = results.vehicleData

    // Year match
    if (candidate.vehicleYearFrom !== null || candidate.vehicleYearTo !== null) {
      const yearFrom = candidate.vehicleYearFrom || -Infinity
      const yearTo = candidate.vehicleYearTo || Infinity
      filterMatches.year = vehicleData.year ? (vehicleData.year >= yearFrom && vehicleData.year <= yearTo) : false
    }

    // Model match
    if (candidate.vehicleModel) {
      filterMatches.model = vehicleData.model
        ? candidate.vehicleModel.toLowerCase() === vehicleData.model.toLowerCase()
        : false
    }

    // Fuel type match
    if (candidate.vehicleFuelType) {
      filterMatches.fuelType = vehicleData.fuelType
        ? candidate.vehicleFuelType.toLowerCase() === vehicleData.fuelType.toLowerCase()
        : false
    }

    // Engine model match (with wildcard support)
    if (candidate.vehicleEngineModel) {
      if (vehicleData.engineModel) {
        const pattern = candidate.vehicleEngineModel
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
        const regex = new RegExp(`^${pattern}$`, 'i')
        filterMatches.engineModel = regex.test(vehicleData.engineModel)
      } else {
        filterMatches.engineModel = false
      }
    }

    // VIN pattern match
    if (candidate.vinPattern && vehicleData.vin) {
      try {
        const regex = new RegExp(candidate.vinPattern, 'i')
        filterMatches.vinPattern = regex.test(vehicleData.vin)
      } catch {
        filterMatches.vinPattern = false
      }
    }

    return {
      id: candidate.id,
      category: candidate.category,
      subcategory: candidate.subcategory,
      schema: candidate.schema,
      matchScore: candidate.matchScore || 0,
      filterCount: candidate.filterCount || 0,
      mismatchReasons: candidate.mismatchReasons || [],
      filters: {
        yearFrom: candidate.vehicleYearFrom,
        yearTo: candidate.vehicleYearTo,
        model: candidate.vehicleModel,
        fuelType: candidate.vehicleFuelType,
        engineModel: candidate.vehicleEngineModel,
        vinPattern: candidate.vinPattern
      },
      filterMatches
    }
  })

  return (
    <div className="space-y-6">
      {/* Results Header */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
        <h2 className="mb-4 text-lg font-bold text-slate-100">
          Simulation Results
        </h2>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Part Description</p>
            <p dir="auto" className="mt-1 font-semibold text-slate-100">
              {results.partDescription}
            </p>
            {results.translationUsed && results.searchedTerm && (
              <p className="mt-1 text-xs text-cyan-300">
                → Translated to: &quot;{results.searchedTerm}&quot;
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Match Type</p>
            <span className="mt-1 inline-flex items-center rounded-full border border-indigo-400/30 bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold capitalize text-indigo-200">
              {results.matchType || 'Unknown'}
            </span>
          </div>
        </div>

        {results.vehicleData && Object.keys(results.vehicleData).length > 0 && (
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/50 p-4 text-sm">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">Vehicle</h4>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {results.vehicleData.vin && (<><dt className="text-slate-500">VIN</dt><dd className="font-mono text-slate-200">{results.vehicleData.vin}</dd></>)}
              {results.vehicleData.manufacturer && (<><dt className="text-slate-500">Manufacturer</dt><dd className="text-slate-200">{results.vehicleData.manufacturer}</dd></>)}
              {results.vehicleData.model && (<><dt className="text-slate-500">Model</dt><dd className="text-slate-200">{results.vehicleData.model}</dd></>)}
              {results.vehicleData.year && (<><dt className="text-slate-500">Year</dt><dd className="text-slate-200">{results.vehicleData.year}</dd></>)}
              {results.vehicleData.fuelType && (<><dt className="text-slate-500">Fuel</dt><dd className="text-slate-200">{results.vehicleData.fuelType}</dd></>)}
              {results.vehicleData.engineModel && (<><dt className="text-slate-500">Engine</dt><dd className="font-mono text-slate-200">{results.vehicleData.engineModel}</dd></>)}
              {results.vehicleData.licensePlate && (<><dt className="text-slate-500">License Plate</dt><dd className="font-mono text-slate-200">{results.vehicleData.licensePlate}</dd></>)}
            </dl>
          </div>
        )}
      </div>

      {/* Best Match Reasoning */}
      {results.bestMatch && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 p-5">
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-emerald-200">
            <Target className="h-5 w-5 text-emerald-300" />
            Selection Reasoning
          </h3>
          <p className="text-sm text-emerald-300/90">
            {results.bestMatch.reasoning}
          </p>
        </div>
      )}

      {/* No Match Found */}
      {!results.bestMatch && candidatesWithScoring.length === 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/15 p-6">
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-amber-200">
            <AlertCircle className="h-5 w-5 text-amber-300" />
            No Flow Decisions Found
          </h3>
          <p className="text-sm text-amber-300/90">
            No approved flow decisions match the provided part description and vehicle filters.
          </p>
        </div>
      )}

      {/* Candidates List */}
      {candidatesWithScoring.length > 0 && (
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-100">
            <span>All Candidates</span>
            <span className="inline-flex items-center rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-0.5 text-sm font-semibold text-indigo-200">
              {candidatesWithScoring.length}
            </span>
          </h3>

          <CandidatesTable
            candidates={candidatesWithScoring.map((candidate, index) => ({
              ...candidate,
              isSelected: results.bestMatch?.id === candidate.id
            }))}
            vehicleData={results.vehicleData}
          />
        </div>
      )}

      {/* Timestamp */}
      <div className="border-t border-white/10 pt-4 text-center text-xs text-slate-500">
        Simulated at: {new Date(results.timestamp).toLocaleString()}
      </div>
    </div>
  )
}
