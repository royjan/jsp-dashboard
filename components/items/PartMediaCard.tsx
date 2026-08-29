'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageIcon, ZoomIn } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useItemMedia, type ItemMedia } from '@/hooks/use-analytics'

type Marker = { x: number; y: number; radius: number }
type Diagram = NonNullable<ItemMedia['diagram']>

/** Height the dialog spends on chrome (header + caption + padding). */
const DIALOG_CHROME_PX = 190

/**
 * Markers are authored in pixels against the source image (450px wide), so
 * their size is expressed in `cqw` — 1% of the container's width — and the same
 * markup rides the thumbnail and the full-size view without recomputing.
 *
 * The container element MUST be a block box: `container-type: inline-size` does
 * not apply to a non-atomic inline, and when it silently does not apply the
 * markers size against the viewport instead — a 7px dot becomes 55px.
 */
function MarkerLayer({
  diagram,
  ownOnly,
  ownSizePx,
}: {
  diagram: Diagram
  ownOnly?: boolean
  /** Fixed size for the own marker, for thumbnails where cqw would be unreadable. */
  ownSizePx?: number
}) {
  const { width, height } = diagram
  const pos = (m: Marker) => ({
    left: `${(m.x / width) * 100}%`,
    top: `${(m.y / height) * 100}%`,
  })
  const size = (m: Marker, own: boolean) =>
    `${Math.max(own ? 20 : 17, (m.radius || 11) * 2) / width * 100}cqw`

  return (
    <>
      {!ownOnly &&
        diagram.others.flatMap((o) =>
          o.markers.map((m, i) => (
            <span
              key={`o-${o.scheme}-${i}`}
              title={o.name || undefined}
              style={{ ...pos(m), width: size(m, false), height: size(m, false), fontSize: `calc(${size(m, false)} * 0.42)` }}
              className="pointer-events-none absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-slate-500/70 font-mono font-bold leading-none text-white shadow-[0_0_0_1.5px_#fff] dark:bg-slate-400/60"
            >
              {o.scheme}
            </span>
          )),
        )}
      {diagram.markers.map((m, i) => (
        <span
          key={`own-${i}`}
          style={
            ownSizePx
              ? { ...pos(m), width: ownSizePx, height: ownSizePx, fontSize: ownSizePx * 0.55 }
              : { ...pos(m), width: size(m, true), height: size(m, true), fontSize: `calc(${size(m, true)} * 0.5)` }
          }
          className="pointer-events-none absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-orange-500 font-mono font-extrabold leading-none text-white shadow-[0_0_0_2px_#fff,0_0_0_4px_rgba(249,115,22,0.45)]"
        >
          {diagram.scheme}
        </span>
      ))}
    </>
  )
}

interface Slide {
  kind: 'photo' | 'diagram'
  title: string
  caption: React.ReactNode
}

export function PartMediaCard({ code, isHe }: { code: string; isHe: boolean }) {
  const { data } = useItemMedia(code)
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [photoFailed, setPhotoFailed] = useState(false)
  const touchX = useRef<number | null>(null)

  const diagram = data?.diagram ?? null
  const hasPhoto = !!data?.hasImage && !photoFailed
  const photoSrc = `/api/items/${encodeURIComponent(data?.imageCode || code)}/image${
    data?.imageVersion ? `?v=${data.imageVersion}` : ''
  }`

  const slides: Slide[] = []
  if (hasPhoto) {
    slides.push({
      kind: 'photo',
      title: isHe ? 'תמונת מוצר' : 'Product photo',
      caption: <span className="font-mono">{code}</span>,
    })
  }
  if (diagram) {
    slides.push({
      kind: 'diagram',
      title: isHe ? 'תרשים מפורק' : 'Exploded diagram',
      caption: (
        <>
          <span className="inline-block size-2 rounded-full bg-orange-500" />
          {isHe ? (
            <>הפריט הוא מספר <b className="font-extrabold text-foreground">{diagram.scheme}</b> בתרשים</>
          ) : (
            <>this part is callout <b className="font-extrabold text-foreground">{diagram.scheme}</b></>
          )}
        </>
      ),
    })
  }

  // Arrow keys on a desktop, a swipe on a phone — the dialog owns Escape.
  useEffect(() => {
    if (!open || slides.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      // RTL reads right-to-left, so ArrowLeft advances.
      const dir = e.key === 'ArrowLeft' ? (isHe ? 1 : -1) : isHe ? -1 : 1
      setIndex((i) => (i + dir + slides.length) % slides.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, slides.length, isHe])

  if (!data || slides.length === 0) return null

  const step = (d: number) => setIndex((i) => (i + d + slides.length) % slides.length)
  const current = slides[Math.min(index, slides.length - 1)]

  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0]?.clientX ?? null }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current
    touchX.current = null
    if (start == null || slides.length < 2) return
    const dx = (e.changedTouches[0]?.clientX ?? start) - start
    if (Math.abs(dx) < 40) return
    // Swiping left pulls the next image in, in either direction of text.
    step(dx < 0 ? 1 : -1)
  }

  // The diagram is portrait (450x545): deriving its width from the free height
  // is what keeps the whole thing on screen instead of making the reader scroll
  // a picture whose point is to be seen at once.
  const ratio = diagram ? diagram.width / diagram.height : 1
  const diagramWidth = `min(560px, calc(100vw - 2.5rem), calc((100dvh - ${DIALOG_CHROME_PX}px) * ${ratio.toFixed(4)}))`

  const openAt = (kind: Slide['kind']) => {
    const i = slides.findIndex((s) => s.kind === kind)
    setIndex(i < 0 ? 0 : i)
    setOpen(true)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          {isHe ? 'תמונה ותרשים' : 'Photo & diagram'}
          {diagram && (
            <span className="text-[11px] font-normal tracking-wide text-muted-foreground">
              {diagram.schemaName}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-start gap-3">
          {hasPhoto && (
            <button
              type="button"
              onClick={() => openAt('photo')}
              aria-label={isHe ? 'הגדל תמונת מוצר' : 'Enlarge product photo'}
              className="relative size-28 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-muted transition-colors hover:border-primary"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc}
                alt=""
                onError={() => setPhotoFailed(true)}
                className="size-full object-contain p-1"
              />
              <ZoomIn className="absolute start-1 top-1 size-5 rounded bg-black/60 p-1 text-white" />
            </button>
          )}

          {diagram && (
            <button
              type="button"
              onClick={() => openAt('diagram')}
              aria-label={isHe ? 'הגדל תרשים' : 'Enlarge diagram'}
              className="relative w-[150px] shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-white transition-colors hover:border-primary"
            >
              {/* Only this part's callout is drawn here: at 150px the other
                  twenty are illegible dots, and the one that matters is the
                  reason the thumbnail exists. */}
              <div className="relative block leading-[0]" style={{ containerType: 'inline-size' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={diagram.imageUrl}
                  width={diagram.width}
                  height={diagram.height}
                  alt=""
                  className="block h-auto w-full"
                />
                <MarkerLayer diagram={diagram} ownOnly ownSizePx={19} />
              </div>
              <ZoomIn className="absolute start-1 top-1 size-5 rounded bg-black/60 p-1 text-white" />
            </button>
          )}

          <p className="min-w-[140px] flex-1 self-center text-xs text-muted-foreground">
            {isHe
              ? 'לחיצה על תמונה — הגדלה'
              : 'Tap an image to enlarge'}
            {slides.length > 1 && (
              <span className="block">
                {isHe ? 'מעבר בין התמונות: החלקה או חיצי המקלדת' : 'Swipe or arrow keys to switch'}
              </span>
            )}
          </p>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="w-[min(600px,calc(100vw-1rem))] max-w-none max-h-[96dvh] gap-2 overflow-hidden p-3 sm:p-3"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle className="flex flex-wrap items-baseline gap-2 text-sm">
              {current.title}
              {current.kind === 'diagram' && diagram && (
                <span className="hidden text-[11px] font-normal whitespace-nowrap text-muted-foreground sm:inline">
                  {diagram.schemaName}
                </span>
              )}
            </DialogTitle>
            {slides.length > 1 && (
              <div className="ms-auto flex items-center gap-1">
                <span dir="ltr" className="me-1 text-[11px] tabular-nums text-muted-foreground">
                  {index + 1} / {slides.length}
                </span>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label={isHe ? 'הקודם' : 'Previous'}
                  className="grid size-9 place-items-center rounded-md border hover:bg-muted"
                >
                  <ChevronRight className="size-4 rtl:rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={isHe ? 'הבא' : 'Next'}
                  className="grid size-9 place-items-center rounded-md border hover:bg-muted"
                >
                  <ChevronLeft className="size-4 rtl:rotate-180" />
                </button>
              </div>
            )}
          </div>

          <div className="grid place-items-center overflow-hidden rounded-lg bg-muted">
            {current.kind === 'photo' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={photoSrc}
                alt=""
                className="block h-auto max-h-[calc(100dvh-190px)] w-auto max-w-[min(560px,calc(100vw-2.5rem))] object-contain"
              />
            ) : diagram ? (
              <div
                className="relative block bg-white leading-[0]"
                style={{ containerType: 'inline-size', width: diagramWidth }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={diagram.imageUrl}
                  width={diagram.width}
                  height={diagram.height}
                  alt=""
                  className="block h-auto w-full"
                />
                <MarkerLayer diagram={diagram} />
              </div>
            ) : null}
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{current.caption}</p>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
