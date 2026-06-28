import { redirect } from 'next/navigation'

export default async function FlowDecisionStatusPage({ params }: { params: Promise<{ status: string }> }) {
  const { status } = await params
  redirect(`/chat/flow-decisions?status=${encodeURIComponent(status)}`)
}
