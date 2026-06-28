'use client'

import React, { useState } from 'react'
import { Info } from 'lucide-react'

export interface VehicleInputData {
  vin?: string
  licensePlate?: string
  year?: number
  model?: string
  fuelType?: string
  engineModel?: string
}

interface SimulatorVehicleInputProps {
  onVehicleDataChange: (data: VehicleInputData) => void
  initialData?: VehicleInputData
}

export default function SimulatorVehicleInput({
  onVehicleDataChange,
  initialData = {}
}: SimulatorVehicleInputProps) {
  const [inputMethod, setInputMethod] = useState<'vin' | 'plate' | 'manual'>('manual')
  const [vin, setVin] = useState(initialData.vin || '')
  const [licensePlate, setLicensePlate] = useState(initialData.licensePlate || '')
  const [year, setYear] = useState(initialData.year?.toString() || '')
  const [model, setModel] = useState(initialData.model || '')
  const [fuelType, setFuelType] = useState(initialData.fuelType || '')
  const [engineModel, setEngineModel] = useState(initialData.engineModel || '')

  const handleUpdate = () => {
    const data: VehicleInputData = {}

    if (inputMethod === 'vin' && vin) {
      // VIN lookup only - clear manual fields
      data.vin = vin
    } else if (inputMethod === 'plate' && licensePlate) {
      // License plate lookup only - clear manual fields
      data.licensePlate = licensePlate
    } else if (inputMethod === 'manual') {
      // Manual input only - include only filled fields
      if (year) data.year = parseInt(year)
      if (model) data.model = model
      if (fuelType) data.fuelType = fuelType
      if (engineModel) data.engineModel = engineModel
    }

    onVehicleDataChange(data)
  }

  // Clear fields when switching input methods
  React.useEffect(() => {
    if (inputMethod === 'manual') {
      // Clear VIN and license plate when switching to manual
      setVin('')
      setLicensePlate('')
    } else if (inputMethod === 'vin') {
      // Clear license plate and manual fields when switching to VIN
      setLicensePlate('')
      setYear('')
      setModel('')
      setFuelType('')
      setEngineModel('')
    } else if (inputMethod === 'plate') {
      // Clear VIN and manual fields when switching to plate
      setVin('')
      setYear('')
      setModel('')
      setFuelType('')
      setEngineModel('')
    }
  }, [inputMethod])

  // Auto-update when any field changes
  React.useEffect(() => {
    handleUpdate()
  }, [vin, licensePlate, year, model, fuelType, engineModel, inputMethod])

  const methods: { key: 'vin' | 'plate' | 'manual'; label: string }[] = [
    { key: 'vin', label: 'VIN Lookup' },
    { key: 'plate', label: 'License Plate' },
    { key: 'manual', label: 'Manual Input' }
  ]

  const inputBaseClass =
    'h-11 w-full rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-slate-100 placeholder:text-slate-500 transition-colors focus:border-cyan-400/50 focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="space-y-6">
      {/* Input Method Selector — segmented control */}
      <div className="space-y-2">
        <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
          Vehicle Input Method
        </label>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {methods.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setInputMethod(m.key)}
              aria-pressed={inputMethod === m.key}
              className={`h-9 rounded-lg px-3 text-sm font-medium transition-all ${
                inputMethod === m.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* VIN Input */}
      {inputMethod === 'vin' && (
        <div className="space-y-2">
          <label
            htmlFor="sim-vin-input"
            className="block text-xs font-medium uppercase tracking-wide text-slate-400"
          >
            VIN (Vehicle Identification Number)
          </label>
          <input
            id="sim-vin-input"
            type="text"
            dir="auto"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="e.g., VF3LCYHZPHS123456"
            className={`${inputBaseClass} font-mono`}
            maxLength={17}
          />
          <p className="text-xs text-slate-500">
            17-character VIN will auto-populate vehicle data
          </p>
        </div>
      )}

      {/* License Plate Input */}
      {inputMethod === 'plate' && (
        <div className="space-y-2">
          <label
            htmlFor="sim-plate-input"
            className="block text-xs font-medium uppercase tracking-wide text-slate-400"
          >
            License Plate Number
          </label>
          <input
            id="sim-plate-input"
            type="text"
            dir="auto"
            value={licensePlate}
            onChange={(e) => setLicensePlate(e.target.value)}
            placeholder="e.g., 12-345-67"
            className={inputBaseClass}
          />
          <p className="text-xs text-slate-500">
            License plate will be converted to VIN and auto-populate data
          </p>
        </div>
      )}

      {/* Manual Filter Fields - Only enabled for manual input */}
      {inputMethod === 'manual' && (
        <div className="space-y-4 border-t border-white/10 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Vehicle Filters
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {/* Year */}
            <div className="space-y-2">
              <label
                htmlFor="sim-year-input"
                className="block text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Year
              </label>
              <input
                id="sim-year-input"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g., 2023"
                className={inputBaseClass}
                min="1900"
                max="2100"
              />
            </div>

            {/* Model */}
            <div className="space-y-2">
              <label
                htmlFor="sim-model-input"
                className="block text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Vehicle Model
              </label>
              <input
                id="sim-model-input"
                type="text"
                dir="auto"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g., C3, 208, 5008"
                className={inputBaseClass}
              />
            </div>

            {/* Fuel Type */}
            <div className="space-y-2">
              <label
                htmlFor="sim-fuel-input"
                className="block text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Fuel Type
              </label>
              <input
                id="sim-fuel-input"
                type="text"
                dir="auto"
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                placeholder="e.g., בנזין, דיזל, Gasoline"
                className={inputBaseClass}
              />
            </div>

            {/* Engine Model */}
            <div className="space-y-2">
              <label
                htmlFor="sim-engine-input"
                className="block text-xs font-medium uppercase tracking-wide text-slate-400"
              >
                Engine Model
              </label>
              <input
                id="sim-engine-input"
                type="text"
                dir="auto"
                value={engineModel}
                onChange={(e) => setEngineModel(e.target.value)}
                placeholder="e.g., HN05, HN**, EB2DT"
                className={`${inputBaseClass} font-mono`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Info message for VIN/Plate lookup */}
      {(inputMethod === 'vin' || inputMethod === 'plate') && (
        <div className="border-t border-white/10 pt-4">
          <p className="flex items-start gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-3 text-sm text-cyan-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <span>Vehicle data will be auto-populated from the database lookup</span>
          </p>
        </div>
      )}
    </div>
  )
}
