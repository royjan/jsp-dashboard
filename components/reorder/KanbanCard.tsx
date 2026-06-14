'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, ChevronDown, ChevronUp, Package, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ReorderQueueItem } from '@/lib/db/schema'
import type { ReorderStage } from '@/hooks/use-reorder-queue'
import { useUpdateItem, useDeleteItem } from '@/hooks/use-reorder-queue'
import { format } from 'date-fns'

interface KanbanCardProps {
  item: ReorderQueueItem
  stage: ReorderStage
}

export function KanbanCard({ item, stage }: KanbanCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editQty, setEditQty] = useState(item.approvedQty ?? item.suggestedQty)
  const [editNotes, setEditNotes] = useState(item.notes ?? '')

  const updateItem = useUpdateItem()
  const deleteItem = useDeleteItem()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `item-${item.id}`,
    data: { item, stage },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleQtyBlur = () => {
    if (editQty !== item.approvedQty) {
      updateItem.mutate({ id: item.id, approvedQty: Number(editQty) })
    }
  }

  const handleNotesBlur = () => {
    if (editNotes !== (item.notes ?? '')) {
      updateItem.mutate({ id: item.id, notes: editNotes })
    }
  }

  const urgency = Number(item.urgencyScore) || 0
  const urgencyColor = urgency > 5 ? 'destructive' : urgency > 2 ? 'warning' : 'secondary'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md ${
        isDragging ? 'ring-2 ring-primary/50 shadow-lg' : ''
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab touch-none text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-sm">{item.itemCode}</span>
            {urgency > 0 && (
              <Badge variant={urgencyColor} className="text-[10px] px-1.5 py-0">
                {urgency.toFixed(1)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5" title={item.itemName ?? ''}>
            {item.itemName}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={() => deleteItem.mutate(item.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Stats row */}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Package className="h-3 w-3" />
          {item.currentStock ?? 0}
        </span>
        <span className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          {item.avgMonthlySales ? `${Number(item.avgMonthlySales).toFixed(1)}/חודש` : '—'}
        </span>
        {item.price && Number(item.price) > 0 && (
          <span className="mr-auto">₪{Number(item.price).toFixed(0)}</span>
        )}
      </div>

      {/* Quantity display/edit */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">כמות:</span>
        {stage === 'approved' || stage === 'suggested' ? (
          <input
            type="number"
            value={editQty ?? 0}
            onChange={(e) => setEditQty(Number(e.target.value))}
            onBlur={handleQtyBlur}
            className="h-6 w-16 rounded border bg-background px-1.5 text-xs text-center"
            min={0}
          />
        ) : (
          <span className="text-xs font-medium">
            {(stage === 'ordered' || stage === 'received')
              ? (item.approvedQty ?? item.suggestedQty)
              : item.suggestedQty}
          </span>
        )}
      </div>

      {/* Date when moved to current stage */}
      {(stage === 'ordered' || stage === 'received') && item.movedAt && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {stage === 'ordered' ? 'הוזמן' : 'התקבל'}: {format(new Date(item.movedAt), 'dd/MM/yyyy')}
        </div>
      )}

      {/* Expandable notes */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        הערות
      </button>

      {expanded && (
        <textarea
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="הוסף הערה..."
          className="mt-1 w-full rounded border bg-background px-2 py-1 text-xs resize-none"
          rows={2}
          dir="rtl"
        />
      )}
    </div>
  )
}
