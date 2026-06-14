'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChevronDown,
  ChevronLeft,
  FolderTree,
  Wrench,
  Cog,
  Disc3,
  Zap,
  Wind,
  Droplets,
  Shield,
  Lightbulb,
  Frame,
  Gauge,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Icon mapping for common PSA category codes
const CATEGORY_ICONS: Record<string, typeof Cog> = {
  A: Cog,       // Engine
  B: Droplets,  // Cooling / Lubrication
  C: Zap,       // Electrical
  D: Wind,      // Air / Exhaust
  E: Disc3,     // Transmission
  F: Shield,    // Brakes
  G: Frame,     // Suspension / Steering
  H: Frame,     // Body
  I: Lightbulb, // Lighting
  J: Gauge,     // Instruments
  K: Wrench,    // Accessories
}

interface Category {
  id: string
  code: string
  name: string
  subcategoryCount: number
}

interface Subcategory {
  id: string
  code: string
  name: string
  schemaCount: number
  partCount: number
}

interface CategoryBrowserProps {
  projectId: string
  categories: Category[]
  selectedCategoryId: string | null
  selectedSubcategoryId: string | null
  onSelectCategory: (cat: { id: string; name: string }) => void
  onSelectSubcategory: (sub: { id: string; name: string }) => void
}

export function CategoryBrowser({
  projectId,
  categories,
  selectedCategoryId,
  selectedSubcategoryId,
  onSelectCategory,
  onSelectSubcategory,
}: CategoryBrowserProps) {
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null)

  // Fetch subcategories when a category is expanded
  const { data: subcategories, isLoading: subLoading } = useQuery<Subcategory[]>({
    queryKey: ['catalog-tree', projectId, expandedCategoryId],
    queryFn: async () => {
      const res = await fetch(
        `/api/catalog/tree?projectId=${projectId}&categoryId=${expandedCategoryId}`
      )
      if (!res.ok) throw new Error('Failed to fetch subcategories')
      const data = await res.json()
      return data.subcategories || []
    },
    enabled: !!expandedCategoryId,
    staleTime: 10 * 60 * 1000,
  })

  const handleCategoryClick = (cat: Category) => {
    if (expandedCategoryId === cat.id) {
      setExpandedCategoryId(null)
    } else {
      setExpandedCategoryId(cat.id)
    }
    onSelectCategory({ id: cat.id, name: cat.name })
  }

  const handleSubcategoryClick = (sub: Subcategory) => {
    onSelectSubcategory({ id: sub.id, name: sub.name })
  }

  return (
    <Card className="sticky top-6">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderTree className="h-4 w-4" />
          קטגוריות
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
          {categories.map((cat) => {
            const isExpanded = expandedCategoryId === cat.id
            const isSelected = selectedCategoryId === cat.id
            const Icon = CATEGORY_ICONS[cat.code] || Wrench

            return (
              <div key={cat.id}>
                {/* Category row */}
                <button
                  onClick={() => handleCategoryClick(cat)}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-accent',
                    isSelected && !selectedSubcategoryId && 'bg-primary/10 text-primary font-medium'
                  )}
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0',
                      !isExpanded && '-rotate-90'
                    )}
                  />
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-start truncate">
                    {cat.code} - {cat.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {cat.subcategoryCount}
                  </Badge>
                </button>

                {/* Subcategories */}
                {isExpanded && (
                  <div className="border-e-2 border-primary/20 me-4 ms-9">
                    {subLoading ? (
                      <div className="py-2 px-3 space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-5/6" />
                      </div>
                    ) : subcategories && subcategories.length > 0 ? (
                      subcategories.map((sub) => {
                        const isSubSelected = selectedSubcategoryId === sub.id
                        return (
                          <button
                            key={sub.id}
                            onClick={() => handleSubcategoryClick(sub)}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent',
                              isSubSelected && 'bg-primary/10 text-primary font-medium'
                            )}
                          >
                            <ChevronLeft className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="flex-1 text-start truncate text-xs">
                              {sub.name}
                            </span>
                            {sub.partCount > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {sub.partCount}
                              </span>
                            )}
                          </button>
                        )
                      })
                    ) : (
                      <div className="py-2 px-3 text-xs text-muted-foreground">
                        אין תת-קטגוריות
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
