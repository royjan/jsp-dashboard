'use client'

import NumberFlow from '@number-flow/react'
import { MONEY_MASK } from '@/lib/privacy'
import { useMoneyHidden } from '@/lib/use-money-hidden'

interface AnimatedCounterProps {
  value: number
  format?: 'currency' | 'number' | 'percent'
  className?: string
}

export function AnimatedCounter({ value, format = 'number', className }: AnimatedCounterProps) {
  const moneyHidden = useMoneyHidden()

  if (format === 'currency') {
    // NumberFlow animates digits, so it never passes through lib/format — the
    // headline KPI numbers would stay in the clear without this branch.
    if (moneyHidden) return <span className={className}>{MONEY_MASK}</span>
    return (
      <NumberFlow
        value={value}
        format={{ style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }}
        className={className}
      />
    )
  }

  if (format === 'percent') {
    return (
      <NumberFlow
        value={value / 100}
        format={{ style: 'percent', maximumFractionDigits: 1 }}
        className={className}
      />
    )
  }

  return (
    <NumberFlow
      value={value}
      format={{ maximumFractionDigits: 0 }}
      className={className}
    />
  )
}
