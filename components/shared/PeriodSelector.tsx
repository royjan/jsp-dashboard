'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Period } from '@/lib/types'

const periods: { value: Period; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
]

interface PeriodSelectorProps {
  value: Period
  onChange: (period: Period) => void
  isCustom?: boolean
  onCustom?: () => void
}

export function PeriodSelector({ value, onChange, isCustom, onCustom }: PeriodSelectorProps) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border p-1">
      {periods.map((p) => (
        <Button
          key={p.value}
          variant={!isCustom && value === p.value ? 'default' : 'ghost'}
          size="sm"
          className={cn('h-7 px-2 sm:px-3 text-xs', !isCustom && value === p.value && 'shadow-sm')}
          onClick={() => onChange(p.value)}
        >
          {p.label}
        </Button>
      ))}
      {onCustom && (
        <Button
          variant={isCustom ? 'default' : 'ghost'}
          size="sm"
          className={cn('h-7 px-2 sm:px-3 text-xs', isCustom && 'shadow-sm')}
          onClick={onCustom}
        >
          Custom
        </Button>
      )}
    </div>
  )
}
