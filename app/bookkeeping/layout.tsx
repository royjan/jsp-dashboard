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
import { StaleBanner, YearPicker, useBooksText } from '@/components/books/BooksChrome'
import { useBooksScope } from '@/components/books/use-books-scope'

function BookkeepingShell({ children }: { children: React.ReactNode }) {
  const scope = useBooksScope()
  const { t } = useBooksText()

  return (
    <div className="space-y-4">
      {/* No tab strip: every one of these screens has its own sidebar entry,
          so a strip underneath just said the same thing twice. */}
      <PageHeader title={t('section')} icon={BookOpen} actions={<YearPicker scope={scope} />} />
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
