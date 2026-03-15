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
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex gap-1 rounded-lg border p-1">
      {periods.map((p) => (
        <Button
          key={p.value}
          variant={value === p.value ? 'default' : 'ghost'}
          size="sm"
          className={cn('h-7 px-3 text-xs', value === p.value && 'shadow-sm')}
          onClick={() => onChange(p.value)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  )
}
