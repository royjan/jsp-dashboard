'use client'

import { useState, useRef } from 'react'
import { Camera, X, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  blobToDataUrl, dataUrlBytes, downscaleImage, formatBytes,
} from '@/lib/downscale-image'

interface PhotoCaptureProps {
  deliveryId: string
  photoType?: string
  onUploaded?: (photo: { id: string; photoUrl: string; photoType: string }) => void
}

export function PhotoCapture({ deliveryId, photoType = 'delivery', onUploaded }: PhotoCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // What the driver is about to send, and what the camera handed us. The photo
  // travels as base64 inside a JSON body over a phone signal at someone's door,
  // so the size is worth showing rather than hiding.
  const [size, setSize] = useState<{ sent: number; original: number } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setPreparing(true)
    try {
      // Downscale BEFORE the data URL exists: base64 of a 6MB phone JPEG is an
      // ~8MB string that is then held in state, POSTed, and stored as the row.
      // Failure here returns the original, so a photo is never lost to it.
      const { blob } = await downscaleImage(file)
      const dataUrl = await blobToDataUrl(blob)
      setPreview(dataUrl)
      setSize({ sent: dataUrlBytes(dataUrl), original: file.size })
    } catch {
      setPreview(null)
      setSize(null)
    } finally {
      setPreparing(false)
    }
  }

  const handleUpload = async () => {
    if (!preview) return
    setUploading(true)

    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo: preview,
          photo_type: photoType,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        onUploaded?.(data)
        setPreview(null)
        setSize(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    } catch (err) {
      console.error('Failed to upload photo:', err)
    } finally {
      setUploading(false)
    }
  }

  const handleClear = () => {
    setPreview(null)
    setSize(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapture}
        className="hidden"
      />

      {!preview && (
        <Button
          variant="outline"
          className="w-full h-14 text-base gap-2"
          disabled={preparing}
          onClick={() => inputRef.current?.click()}
        >
          {preparing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              מכין תמונה...
            </>
          ) : (
            <>
              <Camera className="h-5 w-5" />
              צלם תמונה
            </>
          )}
        </Button>
      )}

      {preview && (
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden border">
            <img
              src={preview}
              alt="Preview"
              className="w-full h-48 object-cover"
            />
            <button
              onClick={handleClear}
              className="absolute top-2 left-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {size && (
            <p className="text-xs text-muted-foreground">
              {formatBytes(size.sent)}
              {size.original > size.sent * 1.2 && (
                <> · הוקטן מ-{formatBytes(size.original)}</>
              )}
            </p>
          )}

          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full h-12 text-base gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                מעלה...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                העלה תמונה
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
