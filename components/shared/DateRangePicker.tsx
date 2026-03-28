'use client'

import { useState, useEffect, useRef } from 'react'
import { useLocale } from '@/lib/locale-context'
import { Calendar } from 'lucide-react'

interface DateRangePickerProps {
  dateFrom: string
  dateTo: string
  onChange: (from: string, to: string) => void
}

const MIN_DATE = '2020-01-01'

export function DateRangePicker({ dateFrom, dateTo, onChange }: DateRangePickerProps) {
  const { t } = useLocale()
  const [localFrom, setLocalFrom] = useState(dateFrom)
  const [localTo, setLocalTo] = useState(dateTo)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external changes
  useEffect(() => { setLocalFrom(dateFrom) }, [dateFrom])
  useEffect(() => { setLocalTo(dateTo) }, [dateTo])

  function isValidDate(d: string): boolean {
    if (!d || d.length < 10) return false
    const year = parseInt(d.substring(0, 4), 10)
    return year >= 2020 && year <= new Date().getFullYear() + 1
  }

  function emitChange(from: string, to: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (isValidDate(from) && isValidDate(to)) {
        onChange(from, to)
      }
    }, 400)
  }

  const maxDate = new Date().toISOString().split('T')[0]

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <input
        type="date"
        value={localFrom}
        min={MIN_DATE}
        max={maxDate}
        onChange={(e) => {
          setLocalFrom(e.target.value)
          emitChange(e.target.value, localTo)
        }}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground [color-scheme:dark] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-70"
      />
      <span className="text-muted-foreground text-sm">{t('to')}</span>
      <input
        type="date"
        value={localTo}
        min={MIN_DATE}
        max={maxDate}
        onChange={(e) => {
          setLocalTo(e.target.value)
          emitChange(localFrom, e.target.value)
        }}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground [color-scheme:dark] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-70"
      />
    </div>
  )
}
