'use client'

import React from 'react'

interface AdminPageHeaderProps {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

/**
 * Shared admin page header.
 *
 * The admin shell is ALWAYS dark (bg-[var(--color-bg-base)]) regardless of the
 * `dark` class, so text colors must NOT rely on the `dark:` variant — doing so
 * rendered near-black titles on a near-black background (the "invisible header"
 * bug). Titles here use an explicit light solid color, which is always legible
 * on the dark shell.
 *
 * Forced `dir="ltr"`: every admin label is English, so we read icon → title
 * left-to-right and avoid the RTL "shoved to the right / colon flip" artifacts.
 */
export function AdminPageHeader({
  title,
  subtitle,
  icon,
  actions,
  className = ''
}: AdminPageHeaderProps) {
  return (
    <div dir="ltr" className={`mb-8 relative ${className}`}>
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-4">
          {icon && (
            <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 ring-1 ring-inset ring-white/10">
              <div className="relative z-10 h-6 w-6 text-white [&>svg]:h-6 [&>svg]:w-6">
                {icon}
              </div>
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-100">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-sm text-slate-400">{subtitle}</p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-3">{actions}</div>
        )}
      </div>

      {/* Subtle divider */}
      <div className="mt-6 h-px bg-white/10" />
    </div>
  )
}

export default AdminPageHeader
