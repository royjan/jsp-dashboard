import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, style, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          type={type}
          className={cn(
            'flex w-full rounded-xl border bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-primary)]',
            'border-[var(--color-border-muted)]',
            'transition-all duration-200',
            'placeholder:text-[var(--color-text-muted)]',
            'focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-[var(--color-bg-elevated)]',
            'hover:border-[var(--color-border-emphasis)]',
            'touch-manipulation',
            error && 'border-[var(--color-error)] focus:border-[var(--color-error)] focus:ring-[var(--color-error)]/20',
            className
          )}
          style={{ height: '52px', minHeight: '52px', padding: '14px 20px', ...style }}
          ref={ref}
          aria-invalid={error ? 'true' : undefined}
          {...props}
        />
        {error && (
          <p style={{ marginTop: '10px' }} className="text-xs text-error-400" role="alert">{error}</p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
