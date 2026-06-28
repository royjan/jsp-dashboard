import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] touch-manipulation',
  {
    variants: {
      variant: {
        default:
          'bg-blue-500 text-white shadow hover:bg-blue-600 hover:shadow-md hover:shadow-primary-500/20',
        destructive:
          'bg-[var(--color-error-soft-bg)] text-[var(--color-error-text)] border border-[var(--color-error-soft-border)] hover:bg-[rgba(248,113,113,0.2)]',
        outline:
          'border border-[var(--color-border-muted)] bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-emphasis)]',
        secondary:
          'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border-muted)] hover:bg-[var(--color-bg-hover)] hover:border-[var(--color-border-emphasis)]',
        ghost:
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
        link:
          'text-blue-400 underline underline-offset-4 hover:text-blue-300',
      },
      size: {
        default: 'h-[52px] min-h-[52px] px-7 py-3 gap-3',
        sm: 'h-[48px] min-h-[48px] px-5 py-2.5 text-sm gap-2.5',
        lg: 'h-14 min-h-[56px] px-8 py-3.5 text-base gap-3',
        icon: 'h-[52px] w-[52px] min-h-[52px] min-w-[52px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, loadingText = 'Loading...', children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="mr-sp-sm h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {loadingText}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
