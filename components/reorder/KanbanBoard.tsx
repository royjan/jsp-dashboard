'use client'

import { useCallback, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { Badge } from '@/components/ui/badge'
import { KanbanCard } from './KanbanCard'
import type { ReorderQueueItem } from '@/lib/db/schema'
import type { ReorderStage, ReorderQueueData } from '@/hooks/use-reorder-queue'
import { useMoveItem } from '@/hooks/use-reorder-queue'
import { ScrollArea } from '@/components/ui/scroll-area'

const STAGES: { key: ReorderStage; label: string; color: string; bgColor: string; borderColor: string }[] = [
  { key: 'suggested', label: 'מוצע', color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30' },
  { key: 'approved', label: 'מאושר', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
  { key: 'ordered', label: 'הוזמן', color: 'text-purple-700 dark:text-purple-400', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/30' },
  { key: 'received', label: 'התקבל', color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
]

function KanbanColumn({
  stage,
  items,
}: {
  stage: (typeof STAGES)[number]
  items: ReorderQueueItem[]
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage.key}`,
    data: { stage: stage.key },
  })

  const itemIds = items.map(i => `item-${i.id}`)

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl border ${stage.borderColor} ${stage.bgColor} min-w-[280px] w-full transition-colors ${
        isOver ? 'ring-2 ring-primary/40 bg-accent/30' : ''
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h3 className={`font-semibold text-sm ${stage.color}`}>{stage.label}</h3>
          <Badge variant="secondary" className="text-[10px] h-5 min-w-[20px] justify-center">
            {items.length}
          </Badge>
        </div>
      </div>

      {/* Cards */}
      <ScrollArea className="flex-1 max-h-[calc(100vh-260px)]">
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2 p-2">
            {items.length === 0 && (
              <div className="flex items-center justify-center h-24 text-xs text-muted-foreground border-2 border-dashed border-muted rounded-lg">
                גרור פריטים לכאן
              </div>
            )}
            {items.map(item => (
              <KanbanCard key={item.id} item={item} stage={stage.key} />
            ))}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  )
}

interface KanbanBoardProps {
  data: ReorderQueueData
}

export function KanbanBoard({ data }: KanbanBoardProps) {
  const [activeItem, setActiveItem] = useState<ReorderQueueItem | null>(null)
  const [activeStage, setActiveStage] = useState<ReorderStage | null>(null)
  const moveItem = useMoveItem()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { item, stage } = event.active.data.current as { item: ReorderQueueItem; stage: ReorderStage }
    setActiveItem(item)
    setActiveStage(stage)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveItem(null)
    setActiveStage(null)

    if (!over) return

    const activeData = active.data.current as { item: ReorderQueueItem; stage: ReorderStage }
    let targetStage: ReorderStage | undefined

    // Dropped on a column
    if (String(over.id).startsWith('column-')) {
      targetStage = String(over.id).replace('column-', '') as ReorderStage
    }
    // Dropped on another card — find which column that card is in
    else if (String(over.id).startsWith('item-')) {
      const overData = over.data.current as { item: ReorderQueueItem; stage: ReorderStage } | undefined
      targetStage = overData?.stage
    }

    if (targetStage && targetStage !== activeData.stage) {
      moveItem.mutate({
        id: activeData.item.id,
        stage: targetStage,
        approvedQty: targetStage === 'approved' ? (activeData.item.approvedQty ?? activeData.item.suggestedQty) : undefined,
      })
    }
  }, [moveItem])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 px-1" dir="rtl">
        {STAGES.map(stage => (
          <KanbanColumn
            key={stage.key}
            stage={stage}
            items={data[stage.key]}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeItem && activeStage ? (
          <div className="w-[280px] opacity-90">
            <KanbanCard item={activeItem} stage={activeStage} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
