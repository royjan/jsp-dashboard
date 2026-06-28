'use client'

import React from 'react'

/** Shimmer placeholder while parts-bot metrics load. */
export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="min-h-[130px] animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-[280px] animate-pulse rounded-xl bg-white/5 lg:col-span-2" />
        <div className="h-[280px] animate-pulse rounded-xl bg-white/5" />
      </div>
      <div className="space-y-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1b1b1f)] p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-md bg-white/5" />
        ))}
      </div>
    </div>
  )
}

export default SkeletonDashboard
