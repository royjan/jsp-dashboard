'use client'

import React, { useEffect, useRef, useCallback, ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  showCloseButton?: boolean
  className?: string
  overlayClassName?: string
  contentClassName?: string
  closeOnOverlayClick?: boolean
  closeOnEsc?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'narrow'
}

const FOCUSABLE_ELEMENTS = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({
  isOpen,
  onClose,
  children,
  title,
  showCloseButton = true,
  className = '',
  overlayClassName = '',
  contentClassName = '',
  closeOnOverlayClick = true,
  closeOnEsc = true,
  size = 'md',
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  const sizeClasses = {
    sm: 'max-w-sm min-[2561px]:max-w-md',
    md: 'max-w-md min-[2561px]:max-w-lg',
    lg: 'max-w-lg min-[2561px]:max-w-xl',
    xl: 'max-w-xl min-[2561px]:max-w-2xl',
    '2xl': 'max-w-2xl min-[2561px]:max-w-3xl',
    full: 'max-w-[95vw] min-[1921px]:max-w-[80vw] min-[2561px]:max-w-[70vw]',
    narrow: 'max-w-[66.5vw] min-[1921px]:max-w-[55vw] min-[2561px]:max-w-[45vw]',
  }

  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!contentRef.current) return

      if (event.key === 'Escape' && closeOnEsc) {
        onClose()
        return
      }

      if (event.key === 'Tab') {
        const focusableElements = contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS)
        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]

        if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault()
          firstElement?.focus()
        } else if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault()
          lastElement?.focus()
        }
      }
    },
    [closeOnEsc, onClose],
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    const timer = setTimeout(() => {}, 0)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      clearTimeout(timer)
    }
  }, [isOpen, handleKeyDown])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className={`fixed inset-0 bg-black/25 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 ${overlayClassName}`}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div
        ref={contentRef}
        className={`relative w-full ${sizeClasses[size]} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-gradient-to-b from-gray-900 to-gray-950 dark:from-gray-800 dark:to-gray-900 rounded-xl shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-20 blur-xl" />
          <div className="relative bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl border border-gray-200/20 dark:border-gray-700/30">
            {(title || showCloseButton) && (
              <div
                className="flex items-center justify-between border-b border-gray-200/50 dark:border-gray-700/50"
                style={{ padding: '24px 32px' }}
              >
                {title && (
                  <h2
                    id={titleId}
                    className="text-xl font-semibold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent"
                  >
                    {title}
                  </h2>
                )}
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="ml-auto rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-all active:scale-95 border border-gray-200 dark:border-gray-700 flex items-center justify-center"
                    style={{ width: '48px', height: '48px', minWidth: '48px', minHeight: '48px' }}
                    aria-label="Close modal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
            <div
              className={`max-h-[calc(100dvh-8rem)] sm:max-h-[calc(100vh-12rem)] min-[2561px]:max-h-[calc(100vh-16rem)] overflow-y-auto ${contentClassName}`}
              style={{ padding: '28px 32px' }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
