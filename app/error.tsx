'use client'

/**
 * Route-level error boundary.
 *
 * Before this file existed there were NO error boundaries anywhere in the app,
 * so a single throw during render dropped the user on Next's stock screen —
 * English, no navigation, no retry, and a digest they had no way to report.
 * Every route under app/ now falls back here instead.
 *
 * `reset()` re-renders the segment. That is enough for the failure this
 * actually catches most often: a render that read `undefined` off a payload
 * that arrived late or half-formed.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  React.useEffect(() => {
    // The digest is the only handle a user can quote back, and it is the only
    // part of a production error that is not minified away. Log both.
    console.error('[route-error]', error.digest ?? '(no digest)', error)
  }, [error])

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>

      <div className="max-w-md">
        <h1 className="text-xl font-bold tracking-tight">המסך הזה נפל</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          אפשר לנסות שוב — לרוב זה עובד. אם זה חוזר, שלח את הקוד למטה.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          נסה שוב
        </Button>
        <Button variant="outline" onClick={() => router.push('/')} className="gap-1.5">
          <Home className="h-4 w-4" />
          לעמוד הראשי
        </Button>
      </div>

      {error.digest && (
        <p dir="ltr" className="mt-1 font-mono text-xs text-muted-foreground/70">
          {error.digest}
        </p>
      )}
    </div>
  )
}
