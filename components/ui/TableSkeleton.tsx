import { Skeleton } from '@/components/ui/skeleton'

interface TableSkeletonProps {
  columns?: number
  rows?: number
}

export function TableSkeleton({ columns = 5, rows = 5 }: TableSkeletonProps) {
  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex gap-3 border-b pb-2 mb-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-4 flex-1" />
        ))}
      </div>
      {/* Body rows */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={`r-${rowIdx}`} className="flex gap-3 py-1.5">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton
                key={`r-${rowIdx}-c-${colIdx}`}
                className="h-4 flex-1"
                style={{ opacity: 1 - rowIdx * 0.1 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
