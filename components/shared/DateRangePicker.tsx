'use client'

import { useLocale } from '@/lib/locale-context'
import { Calendar } from 'lucide-react'

interface DateRangePickerProps {
  dateFrom: string
  dateTo: string
  onChange: (from: string, to: string) => void
}

export function DateRangePicker({ dateFrom, dateTo, onChange }: DateRangePickerProps) {
  const { t } = useLocale()

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => onChange(e.target.value, dateTo)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground [color-scheme:dark] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-70"
      />
      <span className="text-muted-foreground text-sm">{t('to')}</span>
      <input
        type="date"
        value={dateTo}
        onChange={(e) => onChange(dateFrom, e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground [color-scheme:dark] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-70"
      />
    </div>
  )
}
