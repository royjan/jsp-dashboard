'use client'

/**
 * The credits tracker moved into the merged Diego & Dora hub (/chat/diego, Dora view).
 * This route survives only so old bookmarks and shared links keep working.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CreditsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/chat/diego?view=dora')
  }, [router])
  return null
}
