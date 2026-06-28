import React from 'react';
import { X, HelpCircle, Car, Calendar, Fuel, Settings2, Hash, Zap } from 'lucide-react';
import { AVAILABLE_LAMBDAS } from '@/lib/chat-admin/lambdas';

interface AdvancedFiltersProps {
  filters: {
    vinPattern: string;
    yearFrom: string;
    yearTo: string;
    engineModel: string;
    fuelType: string;
    modelName: string;
    lambdaTarget?: string;
  };
  onChange: (filters: any) => void;
  onClear: () => void;
}

export function AdvancedFilters({
  filters,
  onChange,
  onClear
}: AdvancedFiltersProps) {
  const hasActiveFilters = Object.values(filters).some(v => v);

  return (
    <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700" style={{ padding: '28px 32px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: '20px' }}>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center" style={{ gap: '12px' }}>
          <Settings2 className="w-5 h-5 text-blue-500" />
          Advanced Filters
        </h3>
        {hasActiveFilters && (
          <button
            onClick={onClear}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center"
            style={{ gap: '6px', padding: '8px 16px', minHeight: '44px' }}
          >
            <X className="w-4 h-4" />
            Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" style={{ gap: '20px' }}>
        {/* VIN Pattern */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300" style={{ gap: '10px' }}>
            <Hash className="w-4 h-4 text-gray-500" />
            VIN Pattern
            <div className="group relative">
              <HelpCircle className="w-4 h-4 text-gray-400 cursor-help" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-64 bg-gray-900 text-white text-xs rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10" style={{ marginBottom: '8px', padding: '14px' }}>
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-gray-900 rotate-45"></div>
                Use "?" as a wildcard for any character.
                <br />Example: 1HGCM82?33A004352
                <br />This matches any character in the 8th position
              </div>
            </div>
          </label>
          <input
            type="text"
            value={filters.vinPattern}
            onChange={(e) => onChange({ ...filters, vinPattern: e.target.value.toUpperCase() })}
            placeholder="e.g., 1HGCM82?33A??????"
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
            style={{ padding: '14px 16px', minHeight: '52px' }}
            maxLength={17}
          />
        </div>

        {/* Year Range */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300" style={{ gap: '10px' }}>
            <Calendar className="w-4 h-4 text-gray-500" />
            Year Range
          </label>
          <div className="flex items-center" style={{ gap: '12px' }}>
            <input
              type="number"
              value={filters.yearFrom}
              onChange={(e) => onChange({ ...filters, yearFrom: e.target.value })}
              placeholder="From"
              min="1900"
              max={new Date().getFullYear() + 1}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              style={{ padding: '14px 16px', minHeight: '52px' }}
            />
            <span className="text-gray-500">-</span>
            <input
              type="number"
              value={filters.yearTo}
              onChange={(e) => onChange({ ...filters, yearTo: e.target.value })}
              placeholder="To"
              min="1900"
              max={new Date().getFullYear() + 1}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              style={{ padding: '14px 16px', minHeight: '52px' }}
            />
          </div>
        </div>

        {/* Engine Model */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300" style={{ gap: '10px' }}>
            <Settings2 className="w-4 h-4 text-gray-500" />
            Engine Model
          </label>
          <input
            type="text"
            value={filters.engineModel}
            onChange={(e) => onChange({ ...filters, engineModel: e.target.value })}
            placeholder="e.g., 2.0L, V6, Turbo"
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            style={{ padding: '14px 16px', minHeight: '52px' }}
          />
        </div>

        {/* Fuel Type */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300" style={{ gap: '10px' }}>
            <Fuel className="w-4 h-4 text-gray-500" />
            Fuel Type
          </label>
          <select
            value={filters.fuelType}
            onChange={(e) => onChange({ ...filters, fuelType: e.target.value })}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            style={{ padding: '14px 16px', minHeight: '52px' }}
          >
            <option value="">All Types</option>
            <option value="gasoline">Gasoline</option>
            <option value="diesel">Diesel</option>
            <option value="electric">Electric</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>

        {/* Model Name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300" style={{ gap: '10px' }}>
            <Car className="w-4 h-4 text-gray-500" />
            Model Name
          </label>
          <input
            type="text"
            value={filters.modelName}
            onChange={(e) => onChange({ ...filters, modelName: e.target.value })}
            placeholder="e.g., Civic, Accord, CR-V"
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            style={{ padding: '14px 16px', minHeight: '52px' }}
          />
        </div>

        {/* Lambda Target */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300" style={{ gap: '10px' }}>
            <Zap className="w-4 h-4 text-purple-500" />
            Lambda Target
          </label>
          <select
            value={filters.lambdaTarget || ''}
            onChange={(e) => onChange({ ...filters, lambdaTarget: e.target.value })}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            style={{ padding: '14px 16px', minHeight: '52px' }}
          >
            <option value="">All Targets</option>
            {AVAILABLE_LAMBDAS.map(lambda => (
              <option key={lambda.id} value={lambda.id}>
                {lambda.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div className="flex flex-wrap" style={{ marginTop: '20px', gap: '12px' }}>
          {filters.vinPattern && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
              VIN: {filters.vinPattern}
              <button
                onClick={() => onChange({ ...filters, vinPattern: '' })}
                className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {(filters.yearFrom || filters.yearTo) && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
              Year: {filters.yearFrom || '∞'} - {filters.yearTo || '∞'}
              <button
                onClick={() => onChange({ ...filters, yearFrom: '', yearTo: '' })}
                className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.engineModel && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
              Engine: {filters.engineModel}
              <button
                onClick={() => onChange({ ...filters, engineModel: '' })}
                className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.fuelType && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
              Fuel: {filters.fuelType}
              <button
                onClick={() => onChange({ ...filters, fuelType: '' })}
                className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.modelName && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
              Model: {filters.modelName}
              <button
                onClick={() => onChange({ ...filters, modelName: '' })}
                className="ml-1 hover:text-blue-900 dark:hover:text-blue-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.lambdaTarget && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm">
              Lambda: {AVAILABLE_LAMBDAS.find(l => l.id === filters.lambdaTarget)?.name || filters.lambdaTarget}
              <button
                onClick={() => onChange({ ...filters, lambdaTarget: '' })}
                className="ml-1 hover:text-purple-900 dark:hover:text-purple-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}