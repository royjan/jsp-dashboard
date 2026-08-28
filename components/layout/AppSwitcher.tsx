'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  LayoutDashboard,
  MessageSquare,
  Upload,
  Wrench,
  Truck,
  Car,
  LayoutGrid,
  Package,
  PenLine,
  DollarSign,
  Building2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface AppItem {
  id: string
  name: string
  description: string
  url: string
  icon: LucideIcon
  color: string
}

const apps: AppItem[] = [
  {
    id: 'dashboard',
    name: 'דשבורד',
    description: 'ניתוח נתונים ותובנות',
    // Was https://dashboard.jan.parts -- the retired AWS App Runner host, which
    // CLAUDE.md flags twice as dead. This IS the dashboard, so it points at
    // itself relatively: correct on Dokploy, in dev, and anywhere else it moves.
    url: '/',
    icon: LayoutDashboard,
    color: '#6366f1',
  },
  {
    id: 'chat',
    name: "צ'אט חלקים",
    description: 'עוזר AI חכם',
    url: 'https://chat.jan.parts',
    icon: MessageSquare,
    color: '#10b981',
  },
  {
    id: 'ebay-uploader',
    name: 'העלאה לאיביי',
    description: 'העלאת מוצרים לאיביי',
    url: 'https://ebay-uploader.jan.parts',
    icon: Upload,
    color: '#e11d48',
  },
  {
    id: 'partly',
    name: 'מיון חלקים',
    description: 'סריקת קטלוג וסיווג חלפים',
    url: 'https://partly.jan.parts',
    icon: Wrench,
    color: '#f97316',
  },
  {
    id: 'delivery',
    name: 'משלוחים',
    description: 'מעקב והוכחות מסירה',
    url: 'https://delivery.jan.parts',
    icon: Truck,
    color: '#f59e0b',
  },
  {
    id: 'ics',
    name: 'מכירות רכב',
    description: 'מעקב מכירות רכב',
    url: 'https://ics.jan.parts',
    icon: Car,
    color: '#ec4899',
  },
  {
    id: 'container',
    name: 'מחסנים',
    description: 'ניהול מלאי ואיתור',
    url: 'https://countainer.jan.parts',
    icon: Package,
    color: '#8b5cf6',
  },
  {
    id: 'sketch',
    name: 'לוח כתיבה',
    description: 'לוח שרטוט דיגיטלי',
    url: 'https://sketch.jan.parts',
    icon: PenLine,
    color: '#06b6d4',
  },
  {
    id: 'finansit',
    name: 'Finansit API',
    description: 'ממשק API פיננסי',
    url: 'https://finansit.jan.parts',
    icon: DollarSign,
    color: '#14b8a6',
  },
  {
    id: 'company',
    name: 'האתר הראשי',
    description: 'האתר הרשמי של JAN',
    url: 'https://jan.co.il',
    icon: Building2,
    color: '#1e3a5f',
  },
]

interface AppSwitcherProps {
  currentApp: string
}

export function AppSwitcher({ currentApp }: AppSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      // Fixed position: panel's right edge aligns with the button's right edge, opens leftward.
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    }
    setOpen((v) => !v)
  }

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggle}
        className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="App Switcher"
        aria-expanded={open}
      >
        <LayoutGrid className="h-5 w-5" />
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] w-[340px] sm:w-[380px] max-w-[calc(100vw-1rem)] rounded-xl border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200"
          style={{ direction: 'rtl', top: pos.top, right: pos.right }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold text-foreground">
              Jan Parts Apps
            </h3>
          </div>

          {/* App Grid */}
          <div className="grid grid-cols-3 gap-1 p-2 max-h-[400px] overflow-y-auto">
            {apps.map((app) => {
              const isCurrent = app.id === currentApp
              const Icon = app.icon
              return (
                <a
                  key={app.id}
                  href={app.url}
                  target={isCurrent ? undefined : '_blank'}
                  rel={isCurrent ? undefined : 'noopener noreferrer'}
                  onClick={(e) => {
                    if (isCurrent) {
                      e.preventDefault()
                      setOpen(false)
                    }
                  }}
                  className={`flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition-all duration-150 hover:bg-accent group ${
                    isCurrent
                      ? 'bg-accent/60 ring-1 ring-primary/30'
                      : ''
                  }`}
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-110"
                    style={{
                      backgroundColor: `${app.color}18`,
                      color: app.color,
                    }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-foreground leading-tight line-clamp-2">
                    {app.name}
                  </span>
                </a>
              )
            })}
          </div>

          {/* Footer */}
          <div className="border-t px-4 py-2">
            <a
              href="https://jan.parts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              jan.parts
            </a>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
