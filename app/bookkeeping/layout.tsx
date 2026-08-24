'use client'

/**
 * The shell for הנהח״ש: title, year picker, tab strip, staleness banner.
 *
 * The strip sticks under the app's TopBar (h-14, z-30), so it sits at
 * `top-14 z-20` with negative margins to clear <main>'s padding — at top-0 it
 * would slide underneath and read as broken.
 */

import { Suspense } from 'react'
import { BookOpen } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { BooksTabs, StaleBanner, YearPicker, useBooksText } from '@/components/books/BooksChrome'
import { useBooksScope } from '@/components/books/use-books-scope'

function BookkeepingShell({ children }: { children: React.ReactNode }) {
  const scope = useBooksScope()
  const { t } = useBooksText()

  return (
    <div className="space-y-4">
      <PageHeader title={t('section')} icon={BookOpen} actions={<YearPicker scope={scope} />} />
      <div className="sticky top-14 z-20 -mx-2 border-b bg-background/95 px-2 backdrop-blur sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6">
        <BooksTabs />
      </div>
      <StaleBanner scope={scope} />
      {children}
    </div>
  )
}

export default function BookkeepingLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams (via the scope hook) needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">טוען…</div>}>
      <BookkeepingShell>{children}</BookkeepingShell>
    </Suspense>
  )
}
