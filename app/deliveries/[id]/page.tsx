'use client'

import { use, useState, useEffect } from 'react'
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
  Package,
  X,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusTimeline } from '@/components/deliveries/StatusTimeline'
import { PhotoCapture } from '@/components/deliveries/PhotoCapture'
import { statusConfig } from '@/components/deliveries/DeliveryCard'
import { ItemLink } from '@/components/shared/ItemLink'
import type { Delivery, DeliveryPhoto, DeliveryStatusLog } from '@/lib/db/schema'

interface DeliveryLine {
  lineNumber: number | null
  itemCode: string
  itemName: string
  quantity: number | null
  unitPrice: number | null
  discountPercent: number | null
  lineTotal: number | null
}
interface DeliveryDocument {
  docFormat: string | null
  docNumber: string | null
  documentTotal: number | null
  lines: DeliveryLine[]
}

interface DeliveryDetail extends Delivery {
  photos: DeliveryPhoto[]
  statusLog: DeliveryStatusLog[]
  documents?: DeliveryDocument[]
  // 'firestore' = read-only (delivery-app owns status/photos); hides write actions.
  source?: string
}

export default function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const queryClient = useQueryClient()
  const [lightbox, setLightbox] = useState<string | null>(null)

  // Close the photo lightbox on ESC.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

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
              <span>
                קוד לקוח:{' '}
                <Link href={`/customers/${encodeURIComponent(delivery.customerCode)}`} className="text-primary hover:underline">
                  {delivery.customerCode}
                </Link>
              </span>
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

      {/* Line items (from the ERP documents attached to the delivery) */}
      {delivery.documents && delivery.documents.some((d) => d.lines.length > 0) && (
        <Card>
          <CardContent className="p-5 space-y-4">
            {delivery.documents.map((doc, di) => (
              <div key={di} className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="font-bold">פריטים</span>
                  {doc.docNumber && (
                    <span className="text-muted-foreground">
                      · מסמך {doc.docNumber}
                      {doc.docFormat ? ` (${doc.docFormat})` : ''}
                    </span>
                  )}
                  <span className="text-muted-foreground">· {doc.lines.length} שורות</span>
                </div>
                <div className="overflow-x-auto -mx-2 px-2">
                  <table className="w-full text-xs sm:text-sm min-w-[520px]">
                    <thead>
                      <tr className="border-b text-muted-foreground text-start">
                        <th className="p-2 text-start font-medium">קוד</th>
                        <th className="p-2 text-start font-medium">תיאור</th>
                        <th className="p-2 text-end font-medium">כמות</th>
                        <th className="p-2 text-end font-medium">מחיר</th>
                        <th className="p-2 text-end font-medium">סה״כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((l, li) => (
                        <tr key={li} className="border-b last:border-0">
                          <td className="p-2">
                            {l.itemCode ? <ItemLink code={l.itemCode} name={l.itemName} showCode /> : '—'}
                          </td>
                          <td className="p-2 truncate max-w-[260px]">{l.itemName || '—'}</td>
                          <td className="p-2 text-end tabular-nums">{l.quantity ?? '—'}</td>
                          <td className="p-2 text-end tabular-nums">
                            {l.unitPrice != null ? l.unitPrice.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                            {l.discountPercent ? <span className="text-muted-foreground"> (-{l.discountPercent}%)</span> : null}
                          </td>
                          <td className="p-2 text-end tabular-nums font-medium">
                            {l.lineTotal != null ? l.lineTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {doc.documentTotal != null && (
                      <tfoot>
                        <tr className="font-bold">
                          <td className="p-2" colSpan={4}>סה״כ מסמך</td>
                          <td className="p-2 text-end tabular-nums">
                            {doc.documentTotal.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Status update buttons */}
      {delivery.source !== 'firestore' && delivery.status !== 'delivered' && delivery.status !== 'failed' && (
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
                <button
                  type="button"
                  key={photo.id}
                  onClick={() => setLightbox(photo.photoUrl)}
                  className="relative rounded-lg overflow-hidden border aspect-square group cursor-zoom-in text-start"
                >
                  <img
                    src={photo.photoUrl}
                    alt={photo.photoType}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
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
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">אין תמונות</p>
          )}

          {/* Upload new photo */}
          {delivery.source !== 'firestore' && delivery.status !== 'pending' && (
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

      {/* Photo lightbox — click backdrop or press ESC to close */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 end-4 text-white/80 hover:text-white"
            aria-label="סגור"
          >
            <X className="h-7 w-7" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
