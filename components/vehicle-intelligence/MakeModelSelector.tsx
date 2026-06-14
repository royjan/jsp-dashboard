'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/lib/locale-context'
import { ChevronDown, Car } from 'lucide-react'

interface ManufacturerData {
  manufacturer: string
  count: number
  models: { model: string; count: number }[]
}

interface MakeModelSelectorProps {
  manufacturers: ManufacturerData[]
  selectedMake: string
  selectedModel: string
  selectedYearRange: string
  onMakeChange: (make: string) => void
  onModelChange: (model: string) => void
  onYearRangeChange: (range: string) => void
  isLoading?: boolean
}

const YEAR_RANGES = [
  { value: '', labelHe: 'כל הגילאים', labelEn: 'All Ages' },
  { value: '0-3', labelHe: '0-3 שנים (חדש)', labelEn: '0-3 years (New)' },
  { value: '3-7', labelHe: '3-7 שנים', labelEn: '3-7 years' },
  { value: '7-12', labelHe: '7-12 שנים', labelEn: '7-12 years' },
  { value: '12+', labelHe: '12+ שנים (ותיק)', labelEn: '12+ years (Veteran)' },
]

export function MakeModelSelector({
  manufacturers,
  selectedMake,
  selectedModel,
  selectedYearRange,
  onMakeChange,
  onModelChange,
  onYearRangeChange,
  isLoading,
}: MakeModelSelectorProps) {
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const models = useMemo(() => {
    if (!selectedMake) return []
    const mfr = manufacturers.find(m => m.manufacturer === selectedMake)
    return mfr?.models || []
  }, [manufacturers, selectedMake])

  const selectedMakeCount = manufacturers.find(m => m.manufacturer === selectedMake)?.count || 0
  const selectedModelCount = models.find(m => m.model === selectedModel)?.count || 0

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle><Skeleton className="h-5 w-40" /></CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Car className="h-5 w-5" />
          {isHe ? 'בחירת יצרן ודגם' : 'Make / Model Selector'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Make selector */}
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">
              {isHe ? 'יצרן' : 'Make'}
            </label>
            <div className="relative">
              <select
                value={selectedMake}
                onChange={(e) => {
                  onMakeChange(e.target.value)
                  onModelChange('')
                }}
                className="w-full h-10 rounded-md border border-input bg-background px-3 pe-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
              >
                <option value="">{isHe ? 'כל היצרנים' : 'All Makes'}</option>
                {manufacturers.map(m => (
                  <option key={m.manufacturer} value={m.manufacturer}>
                    {m.manufacturer} ({m.count.toLocaleString()})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
            {selectedMake && (
              <Badge variant="secondary" className="mt-1 text-xs">
                {selectedMakeCount.toLocaleString()} {isHe ? 'רכבים' : 'vehicles'}
              </Badge>
            )}
          </div>

          {/* Model selector */}
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">
              {isHe ? 'דגם' : 'Model'}
            </label>
            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
                disabled={!selectedMake}
                className="w-full h-10 rounded-md border border-input bg-background px-3 pe-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring appearance-none disabled:opacity-50"
              >
                <option value="">{isHe ? 'כל הדגמים' : 'All Models'}</option>
                {models.map(m => (
                  <option key={m.model} value={m.model}>
                    {m.model} ({m.count.toLocaleString()})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
            {selectedModel && (
              <Badge variant="secondary" className="mt-1 text-xs">
                {selectedModelCount.toLocaleString()} {isHe ? 'רכבים' : 'vehicles'}
              </Badge>
            )}
          </div>

          {/* Year range selector */}
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">
              {isHe ? 'טווח גיל' : 'Age Range'}
            </label>
            <div className="relative">
              <select
                value={selectedYearRange}
                onChange={(e) => onYearRangeChange(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 pe-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring appearance-none"
              >
                {YEAR_RANGES.map(r => (
                  <option key={r.value} value={r.value}>
                    {isHe ? r.labelHe : r.labelEn}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
