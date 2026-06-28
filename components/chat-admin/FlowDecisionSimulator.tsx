'use client'

import React, { useState, useEffect } from 'react'
import { FlaskConical, FileText, BarChart3, Play, RotateCcw, Loader2 } from 'lucide-react'
import SimulatorVehicleInput, { VehicleInputData } from './SimulatorVehicleInput'
import SimulatorResults from './SimulatorResults'
import AutocompleteInput from '@/components/chat-admin/flow/AutocompleteInput'
import { logger } from '@/lib/logger'

export default function FlowDecisionSimulator() {
  const [partDescription, setPartDescription] = useState('')
  const [vehicleData, setVehicleData] = useState<VehicleInputData>({})
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partSuggestions, setPartSuggestions] = useState<string[]>([])

  // Fetch autocomplete suggestions on mount
  useEffect(() => {
    fetch('/api/part-descriptions/autocomplete')
      .then(res => res.json())
      .then(data => {
        if (data.suggestions) {
          setPartSuggestions(data.suggestions)
        }
      })
      .catch(err => {
        logger.error('Failed to fetch part description suggestions:', err)
      })
  }, [])

  const handleSimulate = async () => {
    if (!partDescription.trim()) {
      setError('Please enter a part description')
      return
    }

    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const response = await fetch('/api/flow-decisions/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          partDescription: partDescription.trim(),
          vin: vehicleData.vin,
          licensePlate: vehicleData.licensePlate,
          vehicleData: {
            year: vehicleData.year,
            model: vehicleData.model,
            fuelType: vehicleData.fuelType,
            engineModel: vehicleData.engineModel
          }
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.details || 'Simulation failed')
      }

      setResults(data)
    } catch (err) {
      logger.error('Simulation error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setPartDescription('')
    setVehicleData({})
    setResults(null)
    setError(null)
  }

  const canSimulate = partDescription.trim().length > 0 && !loading

  return (
    <div dir="ltr" className="space-y-4">
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
        <div className="relative flex items-center gap-4 p-5">
          <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-600 ring-1 ring-inset ring-white/10">
            <FlaskConical className="relative z-10 h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-slate-100">
              Flow Decision Simulator
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Test and debug flow decision matching with real-time scoring and filter analysis.
            </p>
          </div>
        </div>
        {/* Subtle divider */}
        <div className="h-px bg-white/10" />
      </div>

      {/* ── Two-column workspace: inputs (left) · results (right, sticky) ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* Inputs */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="relative">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
              <FileText className="h-4 w-4 text-cyan-300" />
              Input
            </h2>

            {/* Part Description */}
            <div className="mb-5 space-y-2">
              <label
                htmlFor="part-description-input"
                className="block text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Part Description
              </label>
              {/* dir="auto" on the wrapper so the inner input inherits BiDi handling
                  for the mixed Hebrew/English placeholder & value. The [&_input]
                  selectors apply the dark palette to AutocompleteInput's input. */}
              <div
                dir="auto"
                className="[&_input]:h-11 [&_input]:w-full [&_input]:rounded-xl [&_input]:border-white/15 [&_input]:bg-white/5 [&_input]:px-4 [&_input]:text-base [&_input]:text-slate-100 [&_input]:placeholder:text-slate-500 [&_input]:focus:border-cyan-400/50 [&_input]:focus:ring-2 [&_input]:focus:ring-cyan-500/30"
              >
                <AutocompleteInput
                  value={partDescription}
                  onChange={setPartDescription}
                  suggestions={partSuggestions}
                  placeholder="e.g., oil filter, brake pad, מסנן שמן, מכסה שסתומים"
                  id="part-description-input"
                />
              </div>
              <p className="text-xs text-slate-500">
                Supports Hebrew and English. Start typing to see suggestions.
              </p>
            </div>

            {/* Vehicle Data Input */}
            <SimulatorVehicleInput
              onVehicleDataChange={setVehicleData}
              initialData={vehicleData}
            />

            {/* Action Buttons */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleSimulate}
                disabled={!canSimulate}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400/60 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Simulating…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Simulate
                  </>
                )}
              </button>
              <button
                onClick={handleReset}
                disabled={loading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Results — sticky on lg+ so a result is visible immediately.
            min-w-0 lets the wide candidates table scroll inside its own
            overflow-x-auto instead of expanding this grid column past the viewport. */}
        <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="relative">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
              <BarChart3 className="h-4 w-4 text-cyan-300" />
              Results
            </h2>

            <SimulatorResults
              results={results}
              loading={loading}
              error={error || undefined}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
