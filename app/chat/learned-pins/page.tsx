import { redirect } from 'next/navigation'

// Learned Pins merged into Flow Decisions — they're the same table (a learned pin
// = a learning-loop flow decision with a pinned direct part). Use the Source filter.
export default async function LearnedPinsPage({
  searchParams,
}: {
  searchParams: Promise<{ prefill?: string }>
}) {
  const { prefill } = await searchParams
  const q = prefill ? `&q=${encodeURIComponent(prefill)}` : ''
  redirect(`/chat/flow-decisions?source=learned${q}`)
}
