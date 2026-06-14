'use client'

import { use } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  ArrowRight,
  MapPin,
  User,
  FileText,
  Clock,
  Camera,
  Truck,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Image,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusTimeline } from '@/components/deliveries/StatusTimeline'
import { PhotoCapture } from '@/components/deliveries/PhotoCapture'
import { statusConfig } from '@/components/deliveries/DeliveryCard'
import type { Delivery, DeliveryPhoto, DeliveryStatusLog } from '@/lib/db/schema'

interface DeliveryDetail extends Delivery {
  photos: DeliveryPhoto[]
  statusLog: DeliveryStatusLog[]
}

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const queryClient = useQueryClient()

  const { data: delivery, isLoading, error } = useQuery<DeliveryDetail>({
    queryKey: ['delivery', id],
    queryFn: async () => {
      const res = await fetch(`/api/deliveries/${id}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
  })

  const statusMutation = useMutation({
    mutationFn: async ({ status, notes }: { status: string; notes?: string }) => {
      // Try to get GPS
      let lat: number | undefined
      let lng: number | undefined
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          })
        })
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch {
        // GPS not available
      }

      const res = await fetch(`/api/deliveries/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, changed_by: 'user', notes, lat, lng }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery', id] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !delivery) {
    return (
      <div className="space-y-4" dir="rtl">
        <Link href="/deliveries">
          <Button variant="ghost" className="gap-2">
            <ArrowRight className="h-4 w-4" />
            חזרה למשלוחים
          </Button>
        </Link>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-destructive">משלוח לא נמצא</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const config = statusConfig[delivery.status] || statusConfig.pending

  return (
    <div className="space-y-6 max-w-3xl mx-auto" dir="rtl">
      {/* Back link */}
      <Link href="/deliveries">
        <Button variant="ghost" className="gap-2">
          <ArrowRight className="h-4 w-4" />
          חזרה למשלוחים
        </Button>
      </Link>

      {/* Header card */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <h1 className="text-xl font-bold">
                {delivery.customerName || 'ללא שם לקוח'}
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span className="font-mono">תעודה {delivery.documentNumber}</span>
              </div>
            </div>
            <Badge className={`text-sm ${config.color}`}>{config.label}</Badge>
          </div>

          {delivery.customerAddress && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div>
                <span>{delivery.customerAddress}</span>
                <a
                  href={`https://www.google.com/maps/search/${encodeURIComponent(delivery.customerAddress)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline mr-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  מפה
                </a>
              </div>
            </div>
          )}

          {delivery.customerCode && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span>קוד לקוח: {delivery.customerCode}</span>
            </div>
          )}

          {delivery.driverName && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Truck className="h-4 w-4" />
              <span>נהג: {delivery.driverName}</span>
            </div>
          )}

          {/* GPS location if delivered */}
          {delivery.deliveryLat && delivery.deliveryLng && (
            <a
              href={`https://www.google.com/maps?q=${delivery.deliveryLat},${delivery.deliveryLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <MapPin className="h-4 w-4" />
              מיקום מסירה: {Number(delivery.deliveryLat).toFixed(5)},{' '}
              {Number(delivery.deliveryLng).toFixed(5)}
            </a>
          )}

          {delivery.notes && (
            <div className="text-sm bg-muted/50 rounded-lg p-3">
              <span className="font-medium">הערות: </span>
              {delivery.notes}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status update buttons */}
      {delivery.status !== 'delivered' && delivery.status !== 'failed' && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-bold text-sm">עדכון סטטוס</h2>
            <div className="grid grid-cols-2 gap-2">
              {delivery.status === 'pending' && (
                <Button
                  onClick={() => statusMutation.mutate({ status: 'assigned' })}
                  disabled={statusMutation.isPending}
                  variant="outline"
                  className="h-12 gap-2"
                >
                  <User className="h-4 w-4" />
                  שייך לנהג
                </Button>
              )}
              {(delivery.status === 'pending' || delivery.status === 'assigned') && (
                <Button
                  onClick={() => statusMutation.mutate({ status: 'in_transit' })}
                  disabled={statusMutation.isPending}
                  className="h-12 gap-2 bg-amber-600 hover:bg-amber-700"
                >
                  <Truck className="h-4 w-4" />
                  יצאתי
                </Button>
              )}
              {delivery.status === 'in_transit' && (
                <Button
                  onClick={() => statusMutation.mutate({ status: 'delivered' })}
                  disabled={statusMutation.isPending}
                  className="h-12 gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  נמסר
                </Button>
              )}
              <Button
                onClick={() => statusMutation.mutate({ status: 'failed' })}
                disabled={statusMutation.isPending}
                variant="destructive"
                className="h-12 gap-2"
              >
                <XCircle className="h-4 w-4" />
                נכשל
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-bold text-sm">היסטוריית סטטוסים</h2>
          </div>
          <StatusTimeline entries={delivery.statusLog} />
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Image className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-bold text-sm">
              תמונות ({delivery.photos?.length || 0})
            </h2>
          </div>

          {delivery.photos && delivery.photos.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {delivery.photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative rounded-lg overflow-hidden border aspect-square"
                >
                  <img
                    src={photo.photoUrl}
                    alt={photo.photoType}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-black/50 px-2 py-1">
                    <p className="text-white text-xs">
                      {photo.photoType === 'delivery'
                        ? 'משלוח'
                        : photo.photoType === 'signature'
                        ? 'חתימה'
                        : 'נזק'}
                    </p>
                    <p className="text-white/70 text-[10px]">
                      {new Date(photo.capturedAt).toLocaleString('he-IL')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">אין תמונות</p>
          )}

          {/* Upload new photo */}
          {delivery.status !== 'pending' && (
            <div className="pt-2">
              <PhotoCapture
                deliveryId={delivery.id}
                onUploaded={() => {
                  queryClient.invalidateQueries({ queryKey: ['delivery', id] })
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timestamps */}
      <Card>
        <CardContent className="p-5 space-y-2 text-sm">
          <h2 className="font-bold text-sm mb-2">זמנים</h2>
          <div className="flex justify-between">
            <span className="text-muted-foreground">נוצר</span>
            <span>{new Date(delivery.createdAt).toLocaleString('he-IL')}</span>
          </div>
          {delivery.assignedAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">שויך</span>
              <span>{new Date(delivery.assignedAt).toLocaleString('he-IL')}</span>
            </div>
          )}
          {delivery.departedAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">יצא</span>
              <span>{new Date(delivery.departedAt).toLocaleString('he-IL')}</span>
            </div>
          )}
          {delivery.deliveredAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">נמסר</span>
              <span>{new Date(delivery.deliveredAt).toLocaleString('he-IL')}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
