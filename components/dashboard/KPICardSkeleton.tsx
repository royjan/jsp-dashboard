import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function KPICardSkeleton() {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-3 sm:p-4 lg:p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1 min-w-0">
            <Skeleton className="h-4 w-24 sm:w-28" />
            <Skeleton className="h-7 sm:h-8 lg:h-9 w-20 sm:w-24" />
          </div>
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        </div>
        <div className="mt-2 flex items-center gap-1">
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  )
}

export function KPIGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <KPICardSkeleton key={i} />
      ))}
    </div>
  )
}
