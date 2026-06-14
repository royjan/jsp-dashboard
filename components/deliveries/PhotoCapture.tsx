'use client'

import { useState, useRef } from 'react'
import { Camera, X, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PhotoCaptureProps {
  deliveryId: string
  photoType?: string
  onUploaded?: (photo: { id: string; photoUrl: string; photoType: string }) => void
}

export function PhotoCapture({ deliveryId, photoType = 'delivery', onUploaded }: PhotoCaptureProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      setPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
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
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="h-5 w-5" />
          צלם תמונה
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
