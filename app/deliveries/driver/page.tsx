'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  ArrowRight,
  Truck,
  MapPin,
  Phone,
  ChevronDown,
  ChevronUp,
  Loader2,
  Navigation,
  Camera,
  CheckCircle2,
  XCircle,
  Package,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PhotoCapture } from '@/components/deliveries/PhotoCapture'
import type { Delivery } from '@/lib/db/schema'

type DeliveryStatus = 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'failed'

function getGPS(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  })
}

export default function DriverPage() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Fetch all deliveries for today that are assigned / in_transit
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['driver-deliveries'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(`/api/deliveries?from=${today}&to=${today}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
    refetchInterval: 30000, // auto-refresh every 30s
  })

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      notes,
    }: {
      id: string
      status: string
      notes?: string
    }) => {
      const gps = await getGPS()
      const res = await fetch(`/api/deliveries/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          changed_by: 'driver',
          notes,
          lat: gps?.lat,
          lng: gps?.lng,
        }),
      })
      if (!res.ok) throw new Error('Failed to update')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-deliveries'] })
    },
  })

  const allDeliveries: Delivery[] = data?.deliveries || []
  // Show deliveries relevant to driver (not yet final)
  const activeDeliveries = allDeliveries.filter(
    (d) => d.status !== 'delivered' && d.status !== 'failed'
  )
  const completedDeliveries = allDeliveries.filter(
    (d) => d.status === 'delivered' || d.status === 'failed'
  )

  const handleStatusChange = useCallback(
    (id: string, status: string) => {
      statusMutation.mutate({ id, status })
    },
    [statusMutation]
  )

  return (
    <div className="min-h-dvh bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-2 safe-area-top border-b">
        <Link href="/deliveries" className="shrink-0">
          <Button variant="ghost" size="icon" className="h-11 w-11">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-2 flex-1">
          <Truck className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">משלוחים שלי</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          onClick={() => refetch()}
        >
          <RefreshCw className="h-5 w-5" />
        </Button>
      </header>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-3 bg-muted/50 text-sm">
        <div className="flex items-center gap-1.5">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{activeDeliveries.length}</span>
          <span className="text-muted-foreground">פעילים</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span className="font-medium">
            {completedDeliveries.filter((d) => d.status === 'delivered').length}
          </span>
          <span className="text-muted-foreground">נמסרו</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-4 pb-8 safe-area-bottom overflow-y-auto space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-muted-foreground">טוען משלוחים...</span>
          </div>
        ) : activeDeliveries.length === 0 && completedDeliveries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
              <Truck className="h-10 w-10 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium">אין משלוחים להיום</p>
            <p className="text-sm text-muted-foreground text-center">
              משלוחים שישויכו אליך יופיעו כאן
            </p>
          </div>
        ) : (
          <>
            {/* Active deliveries */}
            {activeDeliveries.map((delivery) => (
              <DriverDeliveryCard
                key={delivery.id}
                delivery={delivery}
                expanded={expandedId === delivery.id}
                onToggle={() =>
                  setExpandedId(expandedId === delivery.id ? null : delivery.id)
                }
                onStatusChange={handleStatusChange}
                isUpdating={statusMutation.isPending}
              />
            ))}

            {/* Completed section */}
            {completedDeliveries.length > 0 && (
              <div className="space-y-3 mt-6">
                <h2 className="text-sm font-medium text-muted-foreground px-1">
                  הושלמו היום ({completedDeliveries.length})
                </h2>
                {completedDeliveries.map((delivery) => (
                  <CompletedCard key={delivery.id} delivery={delivery} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Driver Delivery Card ──

function DriverDeliveryCard({
  delivery,
  expanded,
  onToggle,
  onStatusChange,
  isUpdating,
}: {
  delivery: Delivery
  expanded: boolean
  onToggle: () => void
  onStatusChange: (id: string, status: string) => void
  isUpdating: boolean
}) {
  const statusButtons = getNextStatusButtons(delivery.status as DeliveryStatus)

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Main row */}
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-3 p-4 text-right"
        >
          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-bold text-base truncate">
              {delivery.customerName || 'ללא שם'}
            </p>
            {delivery.customerAddress && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="truncate">{delivery.customerAddress}</span>
              </div>
            )}
            <p className="text-xs font-mono text-muted-foreground">
              ת.משלוח {delivery.documentNumber}
            </p>
          </div>

          <StatusBadge status={delivery.status as DeliveryStatus} />

          {expanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="px-4 pb-4 space-y-4 border-t pt-4">
            {/* Navigate button */}
            {delivery.customerAddress && (
              <a
                href={`https://waze.com/ul?q=${encodeURIComponent(delivery.customerAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full h-12 rounded-lg bg-blue-500 text-white font-medium text-base"
              >
                <Navigation className="h-5 w-5" />
                נווט עם Waze
              </a>
            )}

            {/* Status action buttons */}
            <div className="grid grid-cols-2 gap-2">
              {statusButtons.map((btn) => (
                <Button
                  key={btn.status}
                  onClick={() => onStatusChange(delivery.id, btn.status)}
                  disabled={isUpdating}
                  variant={btn.variant as any}
                  className={`h-14 text-base font-medium gap-2 ${btn.className || ''}`}
                >
                  {isUpdating ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    btn.icon
                  )}
                  {btn.label}
                </Button>
              ))}
            </div>

            {/* Photo capture */}
            <PhotoCapture
              deliveryId={delivery.id}
              onUploaded={() => {
                // Photo uploaded successfully
              }}
            />

            {/* Notes */}
            {delivery.notes && (
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                <span className="font-medium">הערות: </span>
                {delivery.notes}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Completed Card (compact) ──

function CompletedCard({ delivery }: { delivery: Delivery }) {
  return (
    <Card className="opacity-70">
      <CardContent className="p-3 flex items-center gap-3">
        {delivery.status === 'delivered' ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-red-500 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {delivery.customerName || delivery.documentNumber}
          </p>
          {delivery.deliveredAt && (
            <p className="text-xs text-muted-foreground">
              {new Date(delivery.deliveredAt).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          {delivery.documentNumber}
        </span>
      </CardContent>
    </Card>
  )
}

// ── Helpers ──

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const config: Record<DeliveryStatus, { label: string; className: string }> = {
    pending: {
      label: 'ממתין',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    },
    assigned: {
      label: 'שויך',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    },
    in_transit: {
      label: 'בדרך',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    },
    delivered: {
      label: 'נמסר',
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    },
    failed: {
      label: 'נכשל',
      className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    },
  }
  const c = config[status] || config.pending
  return (
    <Badge className={`shrink-0 ${c.className}`}>{c.label}</Badge>
  )
}

function getNextStatusButtons(
  current: DeliveryStatus
): Array<{
  status: string
  label: string
  icon: React.ReactNode
  variant: string
  className?: string
}> {
  switch (current) {
    case 'pending':
    case 'assigned':
      return [
        {
          status: 'in_transit',
          label: 'יצאתי',
          icon: <Truck className="h-5 w-5" />,
          variant: 'default',
          className: 'bg-amber-600 hover:bg-amber-700',
        },
        {
          status: 'failed',
          label: 'נכשל',
          icon: <XCircle className="h-5 w-5" />,
          variant: 'destructive',
        },
      ]
    case 'in_transit':
      return [
        {
          status: 'delivered',
          label: 'נמסר',
          icon: <CheckCircle2 className="h-5 w-5" />,
          variant: 'default',
          className: 'bg-emerald-600 hover:bg-emerald-700',
        },
        {
          status: 'failed',
          label: 'נכשל',
          icon: <XCircle className="h-5 w-5" />,
          variant: 'destructive',
        },
      ]
    default:
      return []
  }
}
