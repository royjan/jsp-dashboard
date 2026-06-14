import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface ChartSkeletonProps {
  height?: string
  showLegend?: boolean
  showDescription?: boolean
}

export function ChartSkeleton({ height = 'h-[220px] sm:h-[280px] lg:h-[350px]', showLegend = true, showDescription = false }: ChartSkeletonProps) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        {showDescription && <Skeleton className="h-4 w-56 mt-1" />}
      </CardHeader>
      <CardContent>
        {showLegend && (
          <div className="flex items-center gap-4 mb-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
          </div>
        )}
        <Skeleton className={`w-full ${height}`} />
      </CardContent>
    </Card>
  )
}
