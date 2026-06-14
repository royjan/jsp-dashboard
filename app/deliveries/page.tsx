'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  Truck,
  Download,
  Loader2,
  Package,
  CheckCircle2,
  Clock,
  AlertTriangle,
  CalendarDays,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DeliveryBoard } from '@/components/deliveries/DeliveryBoard'
import type { Delivery } from '@/lib/db/schema'

export default function DeliveriesPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [dateFilter, setDateFilter] = useState(
    new Date().toISOString().split('T')[0]
  )

  // Fetch deliveries
  const { data, isLoading, error } = useQuery({
    queryKey: ['deliveries', dateFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/deliveries?from=${dateFilter}&to=${dateFilter}`
      )
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
  })

  // Import today's deliveries mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/deliveries/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateFilter }),
      })
      if (!res.ok) throw new Error('Failed to import')
      return res.json()
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] })
      alert(`יובאו ${result.imported} תעודות משלוח (${result.skipped} כבר קיימות)`)
    },
    onError: () => {
      alert('שגיאה בייבוא תעודות משלוח')
    },
  })

  // Assign driver mutation
  const assignDriverMutation = useMutation({
    mutationFn: async ({
      id,
      driverName,
    }: {
      id: string
      driverName: string
    }) => {
      const res = await fetch(`/api/deliveries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_name: driverName }),
      })
      if (!res.ok) throw new Error('Failed to assign driver')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] })
    },
  })

  const deliveries: Delivery[] = data?.deliveries || []

  // Stats
  const stats = {
    total: deliveries.length,
    pending: deliveries.filter((d) => d.status === 'pending').length,
    assigned: deliveries.filter((d) => d.status === 'assigned').length,
    inTransit: deliveries.filter((d) => d.status === 'in_transit').length,
    delivered: deliveries.filter((d) => d.status === 'delivered').length,
    failed: deliveries.filter((d) => d.status === 'failed').length,
  }

  const handleCardClick = useCallback(
    (delivery: Delivery) => {
      router.push(`/deliveries/${delivery.id}`)
    },
    [router]
  )

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Truck className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">ניהול משלוחים</h1>
            <p className="text-sm text-muted-foreground">
              מעקב וניהול תעודות משלוח (תבנית 21)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-9 rounded-md border px-3 text-sm bg-background"
            />
          </div>

          <Button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            variant="outline"
            className="gap-2"
          >
            {importMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            ייבוא תעודות היום
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="סה״כ"
          value={stats.total}
          icon={<Package className="h-5 w-5 text-primary" />}
        />
        <StatCard
          label="ממתינים"
          value={stats.pending}
          icon={<Clock className="h-5 w-5 text-gray-500" />}
        />
        <StatCard
          label="שויכו"
          value={stats.assigned}
          icon={<Truck className="h-5 w-5 text-blue-500" />}
        />
        <StatCard
          label="בדרך"
          value={stats.inTransit}
          icon={<Truck className="h-5 w-5 text-amber-500" />}
        />
        <StatCard
          label="נמסרו"
          value={stats.delivered}
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
        />
        <StatCard
          label="נכשלו"
          value={stats.failed}
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
        />
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="mr-3 text-muted-foreground">טוען משלוחים...</span>
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-destructive font-medium">שגיאה בטעינת משלוחים</p>
          </CardContent>
        </Card>
      ) : deliveries.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-lg font-medium">אין משלוחים לתאריך זה</p>
              <p className="text-sm text-muted-foreground mt-1">
                לחץ &quot;ייבוא תעודות היום&quot; כדי לייבא תעודות משלוח מפינאנסית
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <DeliveryBoard
          deliveries={deliveries}
          onCardClick={handleCardClick}
        />
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: number
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        {icon}
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}
