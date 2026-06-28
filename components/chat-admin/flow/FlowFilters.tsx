import React, { useState, useEffect, useRef } from 'react';
import { X, HelpCircle, Car, Calendar, Fuel, Settings2, Hash, Plus, AlertCircle, Search, Loader2 } from 'lucide-react';
import { VinPatternModal } from './VinPatternModal';
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'

interface FlowFiltersProps {
  filters: {
    vinPattern: string;
    yearFrom: string;
    yearTo: string;
    engineModel: string;
    fuelType: string;
    modelName: string;
  };
  onChange: (filters: any) => void;
  onClear: () => void;
  compact?: boolean;
}

export function FlowFilters({
  filters,
  onChange,
  onClear,
  compact = false
}: FlowFiltersProps) {
  const [showVinModal, setShowVinModal] = useState(false);
  const [yearError, setYearError] = useState<string>('');
  const [vinLookupLoading, setVinLookupLoading] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = Object.values(filters).some(v => v);

  // Handle click outside to close tooltip
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    };

    if (showTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTooltip]);

  const handleVinPatternSave = (pattern: string) => {
    onChange({ ...filters, vinPattern: pattern });
  };

  const validateYearRange = (yearFrom: string, yearTo: string) => {
    if (yearFrom && yearTo) {
      const fromYear = parseInt(yearFrom);
      const toYear = parseInt(yearTo);
      if (fromYear > toYear) {
        setYearError('Year "To" must be equal to or after Year "From"');
        return false;
      }
    }
    setYearError('');
    return true;
  };

  const handleVinLookup = async () => {
    const vin = filters.vinPattern;
    
    // Check if it's a full VIN (17 characters)
    if (!vin || vin.length !== 17 || vin.includes('?') || vin.includes('[') || vin.includes('(')) {
      toast.warning('Please enter a complete 17-character VIN without wildcards to extract vehicle information.');
      return;
    }

    setVinLookupLoading(true);
    try {
      const response = await fetch(`/api/vehicle/vin?vin=${vin}`);
      const data = await response.json();

      if (response.ok && data.success) {
        const vehicle = data.vehicle;
        
        // Auto-populate filters with extracted data
        onChange({
          ...filters,
          yearFrom: vehicle.year ? vehicle.year.toString() : filters.yearFrom,
          yearTo: vehicle.year ? vehicle.year.toString() : filters.yearTo,
          engineModel: vehicle.engineType || filters.engineModel,
          fuelType: vehicle.fuelType || filters.fuelType,
          modelName: vehicle.model || filters.modelName
        });

        toast.success('Vehicle information extracted successfully!', {
          description: `${vehicle.make} ${vehicle.model} (${vehicle.year})`
        });
      } else {
        toast.error(data.error || 'Could not find vehicle information for this VIN.');
      }
    } catch (error) {
      logger.error('VIN lookup error:', error);
      toast.error('Failed to lookup VIN information. Please try again.');
    } finally {
      setVinLookupLoading(false);
    }
  };

  return (
    <>
      <div className={`bg-gray-50 dark:bg-gray-800 rounded-xl ${compact ? 'p-4' : 'p-6'} border border-gray-200 dark:border-gray-700`}>
      {!compact && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-blue-500" />
            Vehicle Filters
          </h3>
          {hasActiveFilters && (
            <button
              onClick={onClear}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {compact && hasActiveFilters && (
          <div className="flex justify-end">
            <button
              onClick={onClear}
              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          </div>
        )}
        
        {/* VIN Pattern Builder */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <Hash className="w-4 h-4 text-gray-500" />
            VIN Pattern
            <div className="relative" ref={tooltipRef}>
              <HelpCircle 
                className="w-4 h-4 text-gray-400 cursor-help" 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTooltip(!showTooltip);
                }}
              />
              {showTooltip && (
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-64 p-2 bg-gray-900 text-white text-xs rounded-lg z-50 shadow-lg">
                  <div className="absolute right-full top-1/2 -translate-y-1/2 -mr-1 w-2 h-2 bg-gray-900 rotate-45"></div>
                <div className="space-y-1">
                  <div className="font-semibold mb-1">Pattern Syntax:</div>
                  <div className="space-y-0.5">
                    <div><span className="text-blue-300">?</span> = Any character</div>
                    <div><span className="text-blue-300">[ABC]</span> = A or B or C</div>
                    <div><span className="text-blue-300">(X|Y)</span> = X or Y sequence</div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <div className="text-gray-400">Examples:</div>
                    <code className="block text-blue-300">VF3??????????????</code>
                    <code className="block text-blue-300">(VF3|VR3)?????????</code>
                  </div>
                </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowVinModal(true)}
              className="ml-auto text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <Settings2 className="w-3 h-3" />
              Advanced
            </button>
          </label>
          
          <div className="flex gap-2">
            <input
              type="text"
              value={filters.vinPattern}
              onChange={(e) => {
                const value = e.target.value.toUpperCase();
                onChange({ ...filters, vinPattern: value });
              }}
              placeholder="e.g., 1HG[CM]?82?33A??????"
              className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
              maxLength={50}
            />
            {filters.vinPattern && filters.vinPattern.length === 17 && !filters.vinPattern.includes('?') && !filters.vinPattern.includes('[') && !filters.vinPattern.includes('(') && (
              <button
                onClick={handleVinLookup}
                disabled={vinLookupLoading}
                className="px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Extract vehicle information from VIN"
              >
                {vinLookupLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Looking up...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Lookup VIN
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'} gap-4`}>
          {/* Year Range */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Calendar className="w-4 h-4 text-gray-500" />
              Year Range
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={filters.yearFrom}
                onChange={(e) => {
                  const newFilters = { ...filters, yearFrom: e.target.value };
                  if (validateYearRange(e.target.value, filters.yearTo)) {
                    onChange(newFilters);
                  } else {
                    onChange(newFilters); // Still update to show the invalid value
                  }
                }}
                placeholder="From"
                min="1900"
                max={new Date().getFullYear() + 1}
                className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm ${
                  yearError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              <span className="text-gray-500">-</span>
              <input
                type="number"
                value={filters.yearTo}
                onChange={(e) => {
                  const newFilters = { ...filters, yearTo: e.target.value };
                  if (validateYearRange(filters.yearFrom, e.target.value)) {
                    onChange(newFilters);
                  } else {
                    onChange(newFilters); // Still update to show the invalid value
                  }
                }}
                placeholder="To"
                min="1900"
                max={new Date().getFullYear() + 1}
                className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm ${
                  yearError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
            </div>
            {yearError && (
              <div className="flex items-center gap-1 text-red-500 text-xs mt-1">
                <AlertCircle className="w-3 h-3" />
                <span>{yearError}</span>
              </div>
            )}
          </div>

          {/* Engine Model */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Settings2 className="w-4 h-4 text-gray-500" />
              Engine Model
            </label>
            <input
              type="text"
              value={filters.engineModel}
              onChange={(e) => onChange({ ...filters, engineModel: e.target.value })}
              placeholder="e.g., 2.0L, V6, Turbo"
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          {/* Fuel Type */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Fuel className="w-4 h-4 text-gray-500" />
              Fuel Type
            </label>
            <select
              value={filters.fuelType || ''}
              onChange={(e) => onChange({ ...filters, fuelType: e.target.value || null })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="">All Types</option>
              <option value="בנזין">בנזין</option>
              <option value="גז טבעי דחוס">גז טבעי דחוס</option>
              <option value="גפמ">גפמ</option>
              <option value="דיזל">דיזל</option>
              <option value="חשמל">חשמל</option>
              <option value="חשמל/בנזין">חשמל/בנזין</option>
              <option value="חשמל/דיזל">חשמל/דיזל</option>
              <option value="לא ידוע קוד">לא ידוע קוד</option>
              <option value="נפט">נפט</option>
            </select>
          </div>

          {/* Model Name */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Car className="w-4 h-4 text-gray-500" />
              Model Name
            </label>
            <input
              type="text"
              value={filters.modelName}
              onChange={(e) => onChange({ ...filters, modelName: e.target.value })}
              placeholder="e.g., Civic, Accord, CR-V"
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>
        </div>
      </div>
    </div>
    
      {/* VIN Pattern Modal */}
      <VinPatternModal
        isOpen={showVinModal}
        onClose={() => setShowVinModal(false)}
        initialPattern={filters.vinPattern}
        onSave={handleVinPatternSave}
      />
    </>
  );
}