'use client'

import React from 'react'
import { STAT_CARD_COLORS, type StatCardColor } from './colors'

interface AdminStatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  color: StatCardColor
  progress?: number // 0-100
  onClick?: () => void
  className?: string
  /** Use compact layout for smaller cards */
  compact?: boolean
}

export function AdminStatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  progress,
  onClick,
  className = '',
  compact = false
}: AdminStatCardProps) {
  const colors = STAT_CARD_COLORS[color]

  return (
    <div
      className={`
        relative group
        ${colors.gradient}
        rounded-xl
        border ${colors.border}
        transition-all duration-300
        ${colors.hoverShadow}
        hover:-translate-y-0.5
        overflow-hidden
        ${compact ? 'min-h-[130px]' : 'min-h-[160px]'}
        ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      onClick={onClick}
    >
      {/* Hover gradient border glow */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      {/* Main Content */}
      <div style={{ padding: compact ? '20px 24px' : '24px 28px' }}>
        <div className="flex items-start" style={{ gap: '20px' }}>
          {/* Icon Badge - frosted glass with glow */}
          <div
            className={`${colors.iconBg} rounded-xl border border-white/[0.06] transition-all duration-300 group-hover:scale-105`}
            style={{ padding: compact ? '14px' : '18px', backdropFilter: 'blur(8px)' }}
          >
            <div className={`${compact ? 'w-5 h-5' : 'w-7 h-7'} ${colors.iconColor} transition-colors duration-300`}>
              {icon}
            </div>
          </div>

          {/* Text Content */}
          <div className="flex-1 min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 truncate">
              {title}
            </p>
            <p className={`${compact ? 'text-2xl' : 'text-3xl'} font-semibold tracking-tight ${colors.valueColor}`}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            {subtitle && (
              <p className="text-sm text-slate-500 dark:text-slate-400 truncate" style={{ marginTop: '4px' }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar with shimmer */}
        {progress !== undefined && (
          <div className="flex items-center" style={{ marginTop: '20px', gap: '16px' }}>
            <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700/30 rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${colors.progressBar} rounded-full transition-all duration-500 relative overflow-hidden`}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                    backgroundSize: '200% 100%',
                    animation: 'progressShine 2s ease-in-out infinite'
                  }}
                />
              </div>
            </div>
            <span className="text-sm text-slate-500 dark:text-slate-400 min-w-[3.5rem] text-right tabular-nums">
              {progress.toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminStatCard
