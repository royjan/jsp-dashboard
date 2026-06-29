'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'

const MIN_DATE = '2020-01-01'

const PRESETS: { key: string; he: string; en: string; days: number | null }[] = [
  { key: '1m', he: 'חודש', en: '1M', days: 30 },
  { key: '3m', he: '3 חודשים', en: '3M', days: 90 },
  { key: '1y', he: 'שנה', en: '1Y', days: 365 },
  { key: '3y', he: '3 שנים', en: '3Y', days: 365 * 3 },
  { key: 'all', he: 'הכל', en: 'All', days: null },
]

function fromForDays(days: number | null): string {
  if (days == null) return MIN_DATE
  return new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0]
}

interface DateRangePresetsProps {
  dateFrom: string
  dateTo: string
  onChange: (from: string, to: string) => void
}

/** Quick date-range presets (month / 3 months / year / 3 years / all) that set
 *  date_from..today. Pairs with DateRangePicker for custom ranges. */
export function DateRangePresets({ dateFrom, dateTo, onChange }: DateRangePresetsProps) {
  const { locale } = useLocale()
  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="flex flex-wrap gap-1 rounded-lg border p-1">
      {PRESETS.map((p) => {
        const from = fromForDays(p.days)
        const active = dateTo === today && dateFrom === from
        return (
          <Button
            key={p.key}
            variant={active ? 'default' : 'ghost'}
            size="sm"
            className={cn('h-7 px-2 sm:px-3 text-xs', active && 'shadow-sm')}
            onClick={() => onChange(from, today)}
          >
            {locale === 'he' ? p.he : p.en}
          </Button>
        )
      })}
    </div>
  )
}
