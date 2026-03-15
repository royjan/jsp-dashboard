'use client'

import NumberFlow from '@number-flow/react'

interface AnimatedCounterProps {
  value: number
  format?: 'currency' | 'number' | 'percent'
  className?: string
}

export function AnimatedCounter({ value, format = 'number', className }: AnimatedCounterProps) {
  if (format === 'currency') {
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
