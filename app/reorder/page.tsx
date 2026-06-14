'use client'

import { KanbanBoard } from '@/components/reorder/KanbanBoard'
import { ReorderToolbar } from '@/components/reorder/ReorderToolbar'
import { useReorderQueue } from '@/hooks/use-reorder-queue'
import { Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ReorderPage() {
  const { data, isLoading, isError, refetch } = useReorderQueue()

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Page header */}
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold">ניהול הזמנות מחדש</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          גרור פריטים בין עמודות כדי לקדם את תהליך ההזמנה
        </p>
      </div>

      {/* Toolbar */}
      <div className="px-4">
        <ReorderToolbar data={data} />
      </div>

      {/* Board */}
      <div className="flex-1 px-4 pb-4 overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>טוען לוח הזמנות...</span>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <span>שגיאה בטעינת הנתונים</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              נסה שוב
            </Button>
          </div>
        )}

        {data && (
          <KanbanBoard data={data} />
        )}
      </div>
    </div>
  )
}
