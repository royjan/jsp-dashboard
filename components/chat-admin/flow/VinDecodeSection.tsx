'use client';

import React, { useState } from 'react';
import {
  Car,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { L } from './labels';

export interface VehicleInfo {
  manufacturer?: string;
  model?: string;
  year?: number;
  fuelType?: string;
  engineModel?: string;
}

interface VinDecodeSectionProps {
  onVehicleDecoded?: (vehicleInfo: VehicleInfo, vin: string) => void;
  /** If true, section is collapsed by default */
  defaultCollapsed?: boolean;
  /** Supported brands to show in description */
  supportedBrands?: string;
}

export function VinDecodeSection({
  onVehicleDecoded,
  defaultCollapsed = true,
  supportedBrands = 'MG, BYD, Geely, Xiaopeng'
}: VinDecodeSectionProps) {
  const [vin, setVin] = useState('');
  const [vinStatus, setVinStatus] = useState<'idle' | 'decoding' | 'decoded' | 'error'>('idle');
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const decodeVin = async () => {
    if (vin.length !== 17) return;

    setVinStatus('decoding');
    setDecodeError(null);

    try {
      const response = await fetch(`/api/vin17/decode?vin=${encodeURIComponent(vin)}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to decode VIN');
      }

      // API returns vehicle info under data.data
      const vehicleData = data.data || data;
      const info: VehicleInfo = {
        manufacturer: vehicleData.manufacturer,
        model: vehicleData.model,
        year: vehicleData.year,
        fuelType: vehicleData.fuelType,
        engineModel: vehicleData.engineModel,
      };

      setVehicleInfo(info);
      setVinStatus('decoded');

      if (onVehicleDecoded) {
        onVehicleDecoded(info, vin);
      }
    } catch (error) {
      setDecodeError(error instanceof Error ? error.message : 'Failed to decode VIN');
      setVinStatus('error');
    }
  };

  const reset = () => {
    setVin('');
    setVinStatus('idle');
    setDecodeError(null);
    setVehicleInfo(null);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
            <Car className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-gray-900 dark:text-white">{L.vinDecodeOptional}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Auto-fill vehicle filters from VIN • {supportedBrands}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {vinStatus === 'decoded' && (
            <span className="px-2 py-1 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {L.decoded}
            </span>
          )}
          {isCollapsed ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Collapsible Content */}
      {!isCollapsed && (
        <div className="px-6 pb-6 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                placeholder="הזן VIN בן 17 תווים…"
                maxLength={17}
                className={`w-full px-4 py-3 rounded-lg border text-lg font-mono tracking-wider
                  ${vinStatus === 'error'
                    ? 'border-red-300 dark:border-red-600 focus:ring-red-500'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
                  }
                  bg-white dark:bg-gray-900 text-gray-900 dark:text-white
                  focus:outline-none focus:ring-2 transition-all`}
                disabled={vinStatus === 'decoding'}
              />
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-sm
                ${vin.length === 17 ? 'text-green-600' : 'text-gray-400'}`}>
                {vin.length}/17
              </span>
            </div>
            <button
              type="button"
              onClick={decodeVin}
              disabled={vin.length !== 17 || vinStatus === 'decoding'}
              className={`px-6 py-3 rounded-lg font-medium flex items-center gap-2 transition-all
                ${vin.length === 17 && vinStatus !== 'decoding'
                  ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
            >
              {vinStatus === 'decoding' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Decoding...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  {L.decode}
                </>
              )}
            </button>
          </div>

          {decodeError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{decodeError}</p>
            </div>
          )}

          {vehicleInfo && vinStatus === 'decoded' && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <span className="font-medium text-green-700 dark:text-green-300">{L.vehicleIdentified}</span>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {L.clear}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">יצרן</span>
                  <p className="font-semibold text-gray-900 dark:text-white">{vehicleInfo.manufacturer || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">דגם</span>
                  <p className="font-semibold text-gray-900 dark:text-white">{vehicleInfo.model || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">שנה</span>
                  <p className="font-semibold text-gray-900 dark:text-white">{vehicleInfo.year || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{L.fuelType}</span>
                  <p className="font-semibold text-gray-900 dark:text-white">{vehicleInfo.fuelType || 'N/A'}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
