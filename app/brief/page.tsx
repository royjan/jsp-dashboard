'use client'

/**
 * The morning brief, as a screen.
 *
 * /api/ai/morning-brief has existed for a while and a systemd timer posts it to
 * Telegram at 07:30. It had no page, so the one thing worth reading first was
 * the only thing without an address — and answering "what needs attention
 * today" meant opening receivables, stock, margin and gap in turn.
 *
 * Deliberately thin: it renders what the API already produces rather than
 * recomputing anything. A second implementation of "what matters today" would
 * drift from the one that goes to Telegram, and then the screen and the message
 * would disagree, which is worse than not having the screen.
 */

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Sunrise } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { ErrorState } from '@/components/ui/feedback-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { Provenance } from '@/lib/provenance'

interface Brief {
  summary: string
  bullets: string[]
  generatedAt: string
  cached?: boolean
  degraded?: boolean
}

export default function MorningBriefPage() {
  // Set by the refresh button so the next fetch bypasses the 4h upstream cache.
  // Without it "רענן" re-requested the route and got the same cached prose back,
  // which looks identical to a refresh that worked.
  const forceRef = useRef(false)

  const { data, isLoading, isError, refetch, isFetching } = useQuery<Brief>({
    queryKey: ['morning-brief'],
    queryFn: async () => {
      const force = forceRef.current
      forceRef.current = false
      const res = await fetch(`/api/ai/morning-brief${force ? '?refresh=1' : ''}`)
      if (!res.ok) throw new Error('brief unavailable')
      return res.json()
    },
    // The brief is generated a few times a day and cached for 4h upstream;
    // refetching it on every focus would spend Gemini quota for nothing.
    staleTime: 30 * 60 * 1000,
  })

  // `degraded` means the brief was written from a partial picture — some of the
  // inputs failed. Saying so matters more here than anywhere else in the app,
  // because this screen is prose: a missing figure does not leave a hole, the
  // sentence just quietly stops being true.
  const provenance: Provenance | undefined = data
    ? {
        source: data.cached ? 'redis' : 'postgres',
        asOf: data.generatedAt,
        ...(data.degraded
          ? { scope: 'חלק ממקורות הנתונים לא נענו — התמונה חלקית' }
          : {}),
      }
    : undefined

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={Sunrise}
        title="בריף בוקר"
        description="מה דורש טיפול היום — אותו טקסט שנשלח לטלגרם ב-07:30"
        provenance={provenance}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => { forceRef.current = true; refetch() }}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            רענן
          </Button>
        }
      />

      {isError && (
        <ErrorState
          title="לא ניתן לטעון את הבריף"
          description="הבריף נוצר משילוב של מקורות; אם אחד מהם לא זמין, אין מה להציג."
          onRetry={() => refetch()}
        />
      )}

      {isLoading && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardContent className="p-5">
              <p className="text-base font-semibold leading-relaxed">{data.summary}</p>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {data.bullets.map((b, i) => (
              <Card key={i}>
                {/* The bullets already carry their own leading emoji from the
                    generator, so no icon is added here — two would compete. */}
                <CardContent className="p-4 text-sm leading-relaxed">{b}</CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
