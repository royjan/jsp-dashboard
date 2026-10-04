import { redirect } from 'next/navigation'

/** /bots/<id> opens the overview tab (each tab is its own route). */
export default async function BotIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/bots/${id}/overview`)
}
