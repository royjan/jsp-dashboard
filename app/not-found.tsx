'use client'

/**
 * 404. Reachable both from a bad URL and from `notFound()`.
 *
 * Worth having beyond the obvious: twelve routes in this app were redirect
 * stubs for merged screens, so a stale bookmark or a muscle-memory URL is a
 * realistic way to land here — not just a typo.
 */

import Link from 'next/link'
import { Compass, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Compass className="h-7 w-7 text-primary" />
      </div>

      <div className="max-w-md">
        <h1 className="text-xl font-bold tracking-tight">העמוד הזה לא קיים</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ייתכן שהמסך אוחד למסך אחר, או שהקישור ישן. אפשר לחפש עם ⌘K.
        </p>
      </div>

      <Button asChild className="gap-1.5">
        <Link href="/">
          <Home className="h-4 w-4" />
          לעמוד הראשי
        </Link>
      </Button>
    </div>
  )
}
