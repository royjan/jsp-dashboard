'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryBrowser } from './CategoryBrowser'
import { PartsGrid } from './PartsGrid'
import {
  Search,
  Car,
  Fuel,
  Calendar,
  Palette,
  Hash,
  Clock,
  X,
  AlertTriangle,
} from 'lucide-react'

const STORAGE_KEY = 'vin-catalog-recent'
const MAX_RECENT = 8

interface VehicleInfo {
  vin: string
  licensePlate: string
  manufacturer: string
  model: string
  year: number | null
  fuelType: string
  color: string
  trim: string
}

interface CatalogData {
  projectId: string
  projectName: string
  categories: Array<{
    id: string
    code: string
    name: string
    subcategoryCount: number
  }>
}

interface LookupResult {
  success: boolean
  vehicle: VehicleInfo
  isPSA: boolean
  catalog: CatalogData | null
  error?: string
}

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function addRecentSearch(value: string) {
  const recent = getRecentSearches().filter(s => s !== value)
  recent.unshift(value)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}

export function VinCatalog() {
  const [inputValue, setInputValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<{ id: string; name: string } | null>(null)
  const [selectedSubcategory, setSelectedSubcategory] = useState<{ id: string; name: string } | null>(null)
  const [partsSearchQuery, setPartsSearchQuery] = useState('')

  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [])

  const { data, isLoading, error } = useQuery<LookupResult>({
    queryKey: ['vin-lookup', searchQuery],
    queryFn: async () => {
      const res = await fetch(`/api/catalog/vin-lookup?q=${encodeURIComponent(searchQuery)}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Lookup failed' }))
        throw new Error(err.error || 'Lookup failed')
      }
      return res.json()
    },
    enabled: !!searchQuery,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })

  const handleSearch = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    setSearchQuery(trimmed)
    setSelectedCategory(null)
    setSelectedSubcategory(null)
    setPartsSearchQuery('')
    addRecentSearch(trimmed)
    setRecentSearches(getRecentSearches())
  }, [inputValue])

  const handleRecentClick = (value: string) => {
    setInputValue(value)
    setSearchQuery(value)
    setSelectedCategory(null)
    setSelectedSubcategory(null)
    setPartsSearchQuery('')
  }

  const handleClearRecent = () => {
    localStorage.removeItem(STORAGE_KEY)
    setRecentSearches([])
  }

  const detectType = (val: string): string => {
    const cleaned = val.replace(/[\s-]/g, '')
    if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(cleaned)) return 'VIN'
    if (/^\d{5,8}$/.test(cleaned)) return 'לוחית רישוי'
    return ''
  }

  const inputType = detectType(inputValue)

  return (
    <div className="space-y-6">
      {/* VIN/Plate Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            חיפוש רכב
          </CardTitle>
          <CardDescription>הזן מספר שלדה (VIN) או מספר רישוי ישראלי</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="VIN (17 תווים) או מספר רישוי (7-8 ספרות)"
                className="w-full h-12 px-4 pe-20 rounded-lg border bg-background text-base font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal placeholder:text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                dir="ltr"
                maxLength={17}
              />
              {inputType && (
                <Badge variant="secondary" className="absolute top-1/2 -translate-y-1/2 end-3 text-xs">
                  {inputType}
                </Badge>
              )}
            </div>
            <Button onClick={handleSearch} disabled={!inputValue.trim() || isLoading} size="lg">
              <Search className="h-4 w-4 me-2" />
              חיפוש
            </Button>
          </div>

          {/* Recent searches */}
          {recentSearches.length > 0 && !searchQuery && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  חיפושים אחרונים
                </span>
                <button onClick={handleClearRecent} className="text-xs text-muted-foreground hover:text-foreground">
                  נקה
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleRecentClick(s)}
                    className="px-3 py-1 rounded-md bg-muted text-sm font-mono hover:bg-accent transition-colors"
                    dir="ltr"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {isLoading && (
        <Card>
          <CardContent className="py-8">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              <span className="text-muted-foreground">מחפש רכב...</span>
            </div>
            <div className="mt-4 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <Card className="border-destructive/50">
          <CardContent className="py-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>{(error as Error).message || 'שגיאה בחיפוש רכב'}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vehicle Info Card */}
      {data?.success && data.vehicle && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Car className="h-5 w-5" />
                  {data.vehicle.manufacturer} {data.vehicle.model}
                  {data.vehicle.year ? ` (${data.vehicle.year})` : ''}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {data.isPSA ? (
                    <Badge variant="success">PSA</Badge>
                  ) : (
                    <Badge variant="warning">לא PSA</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => { setSearchQuery(''); setInputValue('') }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {data.vehicle.vin && (
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">VIN</div>
                      <div className="font-mono text-sm" dir="ltr">{data.vehicle.vin}</div>
                    </div>
                  </div>
                )}
                {data.vehicle.licensePlate && (
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">מספר רישוי</div>
                      <div className="font-mono text-sm" dir="ltr">{data.vehicle.licensePlate}</div>
                    </div>
                  </div>
                )}
                {data.vehicle.year && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">שנת ייצור</div>
                      <div className="text-sm">{data.vehicle.year}</div>
                    </div>
                  </div>
                )}
                {data.vehicle.fuelType && (
                  <div className="flex items-center gap-2">
                    <Fuel className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">דלק</div>
                      <div className="text-sm">{data.vehicle.fuelType}</div>
                    </div>
                  </div>
                )}
                {data.vehicle.color && (
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">צבע</div>
                      <div className="text-sm">{data.vehicle.color}</div>
                    </div>
                  </div>
                )}
                {data.vehicle.trim && (
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">רמת גימור</div>
                      <div className="text-sm">{data.vehicle.trim}</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Category Browser or Non-PSA message */}
          {data.isPSA && data.catalog ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-3">
                <CategoryBrowser
                  projectId={data.catalog.projectId}
                  categories={data.catalog.categories}
                  selectedCategoryId={selectedCategory?.id || null}
                  selectedSubcategoryId={selectedSubcategory?.id || null}
                  onSelectCategory={(cat) => {
                    setSelectedCategory(cat)
                    setSelectedSubcategory(null)
                    setPartsSearchQuery('')
                  }}
                  onSelectSubcategory={(sub) => {
                    setSelectedSubcategory(sub)
                    setPartsSearchQuery('')
                  }}
                />
              </div>
              <div className="lg:col-span-9">
                <PartsGrid
                  projectId={data.catalog.projectId}
                  categoryId={selectedCategory?.id || null}
                  subcategoryId={selectedSubcategory?.id || null}
                  categoryName={selectedSubcategory?.name || selectedCategory?.name || null}
                  searchQuery={partsSearchQuery}
                  onSearchChange={setPartsSearchQuery}
                />
              </div>
            </div>
          ) : data.isPSA && !data.catalog ? (
            <Card>
              <CardContent className="py-8 text-center">
                <AlertTriangle className="h-10 w-10 mx-auto text-amber-500 mb-3" />
                <p className="text-lg font-medium mb-1">רכב PSA - קטלוג לא זמין</p>
                <p className="text-muted-foreground text-sm">
                  רכב זה הוא PSA אבל הקטלוג שלו עדיין לא נסרק.
                  <br />
                  ניתן לסרוק אותו דרך מערכת Partly.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <AlertTriangle className="h-10 w-10 mx-auto text-amber-500 mb-3" />
                <p className="text-lg font-medium mb-1">קטלוג מלא זמין רק לרכבי PSA</p>
                <p className="text-muted-foreground text-sm">
                  חיפוש קטלוג אינטראקטיבי זמין עבור Peugeot, Citroen, Opel ו-DS.
                  <br />
                  לרכבים אחרים, ניתן לחפש ישירות לפי מק&quot;ט בלוח הבקרה.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
