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
 * bug). Titles here use an explicit bright gradient on a static element, which
 * is safe (unlike gradient-clipping animated NumberFlow digits).
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
      {/* Ambient glow behind the header for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -left-6 h-40 w-80 rounded-full bg-cyan-500/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-4">
          {icon && (
            <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30 ring-1 ring-inset ring-white/20">
              <div
                aria-hidden
                className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/30 to-transparent opacity-60"
              />
              <div className="relative z-10 h-6 w-6 text-white [&>svg]:h-6 [&>svg]:w-6">
                {icon}
              </div>
            </div>
          )}
          <div>
            <h1 className="bg-gradient-to-r from-white via-cyan-100 to-blue-200 bg-clip-text text-3xl font-bold leading-tight tracking-tight text-transparent">
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

      {/* Accent divider: bright on the left, fading out */}
      <div className="mt-6 h-px bg-gradient-to-r from-cyan-500/50 via-blue-500/20 to-transparent" />
    </div>
  )
}

export default AdminPageHeader
