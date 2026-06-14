'use client'

import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, ThumbsUp, Package, ThumbsDown, CalendarClock,
  Search, Loader2, Check, Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface VisitLoggerProps {
  customerCode: string
  customerName: string
  onClose: () => void
}

type Outcome = 'interested' | 'ordered' | 'not_interested' | 'follow_up'

const OUTCOMES: { value: Outcome; label: string; icon: typeof ThumbsUp; color: string }[] = [
  { value: 'interested', label: 'מעוניין', icon: ThumbsUp, color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30' },
  { value: 'ordered', label: 'הזמין', icon: Package, color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  { value: 'not_interested', label: 'לא מעוניין', icon: ThumbsDown, color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' },
  { value: 'follow_up', label: 'מעקב', icon: CalendarClock, color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
]

export function VisitLogger({ customerCode, customerName, onClose }: VisitLoggerProps) {
  const [visitType, setVisitType] = useState<'planned' | 'walk_in'>('planned')
  const [outcome, setOutcome] = useState<Outcome>('interested')
  const [notes, setNotes] = useState('')
  const [itemInput, setItemInput] = useState('')
  const [itemsShown, setItemsShown] = useState<string[]>([])
  const [followUpDate, setFollowUpDate] = useState('')
  const [saved, setSaved] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()

  const repName = typeof window !== 'undefined'
    ? localStorage.getItem('sales-rep-name') || 'default'
    : 'default'

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/sales-rep/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rep_name: repName,
          customer_code: customerCode,
          customer_name: customerName,
          visit_date: new Date().toISOString().split('T')[0],
          visit_type: visitType,
          notes: notes || null,
          items_shown: itemsShown,
          outcome,
          follow_up_date: followUpDate || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(data.error || 'Failed to save')
      }
      return res.json()
    },
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['sales-rep-visits'] })
      setTimeout(() => onClose(), 1500)
    },
  })

  const addItem = () => {
    const code = itemInput.trim().toUpperCase()
    if (code && !itemsShown.includes(code)) {
      setItemsShown((prev) => [...prev, code])
      setItemInput('')
    }
  }

  const removeItem = (code: string) => {
    setItemsShown((prev) => prev.filter((c) => c !== code))
  }

  if (saved) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" dir="rtl">
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative w-full max-w-lg bg-background rounded-t-2xl p-6 text-center space-y-4 animate-in slide-in-from-bottom">
          <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
            <Check className="h-8 w-8 text-emerald-500" />
          </div>
          <p className="text-xl font-bold">הביקור נשמר!</p>
          <p className="text-muted-foreground">{customerName}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background rounded-t-2xl max-h-[90vh] overflow-y-auto safe-area-bottom">
        {/* Header */}
        <div className="sticky top-0 bg-background z-10 flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">רשום ביקור</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Customer (auto-filled) */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">לקוח</label>
            <Card>
              <CardContent className="p-3">
                <p className="font-semibold">{customerName}</p>
                <p className="text-sm text-muted-foreground font-mono">{customerCode}</p>
              </CardContent>
            </Card>
          </div>

          {/* Visit type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">סוג ביקור</label>
            <div className="flex gap-2">
              <button
                onClick={() => setVisitType('planned')}
                className={`flex-1 py-3 rounded-xl border-2 text-base font-medium transition-colors min-h-[48px] ${
                  visitType === 'planned'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input'
                }`}
              >
                מתוכנן
              </button>
              <button
                onClick={() => setVisitType('walk_in')}
                className={`flex-1 py-3 rounded-xl border-2 text-base font-medium transition-colors min-h-[48px] ${
                  visitType === 'walk_in'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input'
                }`}
              >
                מזדמן
              </button>
            </div>
          </div>

          {/* Outcome */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">תוצאה</label>
            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map((o) => {
                const Icon = o.icon
                return (
                  <button
                    key={o.value}
                    onClick={() => setOutcome(o.value)}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-colors min-h-[48px] ${
                      outcome === o.value
                        ? `${o.color} border-current`
                        : 'border-input text-muted-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {o.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Follow-up date (only if outcome is follow_up) */}
          {outcome === 'follow_up' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">תאריך מעקב</label>
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full h-12 px-4 rounded-xl border-2 border-input bg-background text-base focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          )}

          {/* Items shown */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">פריטים שהוצגו</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={itemInput}
                  onChange={(e) => setItemInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())}
                  placeholder='הקלד מק"ט...'
                  className="w-full h-12 pr-10 pl-4 rounded-xl border-2 border-input bg-background text-base font-mono focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={addItem}
                disabled={!itemInput.trim()}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
            {itemsShown.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {itemsShown.map((code) => (
                  <Badge
                    key={code}
                    variant="secondary"
                    className="text-sm font-mono px-3 py-1.5 gap-1.5 cursor-pointer hover:bg-destructive/10"
                    onClick={() => removeItem(code)}
                  >
                    {code}
                    <X className="h-3 w-3" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">הערות</label>
            <textarea
              ref={notesRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="הערות על הביקור..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl border-2 border-input bg-background text-base resize-none focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Submit */}
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            size="lg"
            className="w-full min-h-[52px] text-lg font-bold"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin ml-2" />
                שומר...
              </>
            ) : (
              'שמור ביקור'
            )}
          </Button>

          {mutation.isError && (
            <p className="text-center text-destructive text-sm">
              {(mutation.error as Error).message || 'שגיאה בשמירה'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
