'use client'

import type { DeliveryStatusLog } from '@/lib/db/schema'

const statusLabels: Record<string, string> = {
  pending: 'ממתין',
  assigned: 'שויך לנהג',
  in_transit: 'בדרך',
  delivered: 'נמסר',
  failed: 'נכשל',
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-400',
  assigned: 'bg-blue-500',
  in_transit: 'bg-amber-500',
  delivered: 'bg-emerald-500',
  failed: 'bg-red-500',
}

interface StatusTimelineProps {
  entries: DeliveryStatusLog[]
}

export function StatusTimeline({ entries }: StatusTimelineProps) {
  if (!entries || entries.length === 0) {
    return <p className="text-sm text-muted-foreground">אין עדכוני סטטוס</p>
  }

  // Sort chronologically (oldest first)
  const sorted = [...entries].sort(
    (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime()
  )

  return (
    <div className="relative space-y-0">
      {sorted.map((entry, i) => {
        const isLast = i === sorted.length - 1
        const dotColor = statusColors[entry.status] || 'bg-gray-400'

        return (
          <div key={entry.id} className="flex gap-3">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full shrink-0 mt-1.5 ${dotColor}`} />
              {!isLast && <div className="w-0.5 flex-1 bg-border min-h-[24px]" />}
            </div>

            {/* Content */}
            <div className="pb-4 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">
                  {statusLabels[entry.status] || entry.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.changedAt).toLocaleString('he-IL')}
                </span>
              </div>

              {entry.changedBy && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  על ידי: {entry.changedBy}
                </p>
              )}

              {entry.notes && (
                <p className="text-xs text-muted-foreground mt-0.5">{entry.notes}</p>
              )}

              {entry.lat && entry.lng && (
                <a
                  href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline mt-0.5 inline-block"
                >
                  {Number(entry.lat).toFixed(5)}, {Number(entry.lng).toFixed(5)} - פתח מפה
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
