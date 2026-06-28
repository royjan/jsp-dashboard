'use client'

import { Check, X, Trash2 } from 'lucide-react'

interface Props {
  count: number
  onClear: () => void
  onApprove: () => void
  onReject: () => void
  onDelete: () => void
}

export function BulkActionToolbar({ count, onClear, onApprove, onReject, onDelete }: Props) {
  return (
    <div className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {count} selected
        </span>
        <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
        <Action onClick={onApprove} icon={<Check className="h-4 w-4" />} tone="emerald">
          Approve
        </Action>
        <Action onClick={onReject} icon={<X className="h-4 w-4" />} tone="rose">
          Reject
        </Action>
        <Action onClick={onDelete} icon={<Trash2 className="h-4 w-4" />} tone="slate">
          Delete
        </Action>
        <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
        <button
          onClick={onClear}
          className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

function Action({
  onClick,
  icon,
  tone,
  children,
}: {
  onClick: () => void
  icon: React.ReactNode
  tone: 'emerald' | 'rose' | 'slate'
  children: React.ReactNode
}) {
  const tones = {
    emerald: 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950',
    rose: 'text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950',
    slate: 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  }
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium transition-colors ${tones[tone]}`}
    >
      {icon}
      {children}
    </button>
  )
}
