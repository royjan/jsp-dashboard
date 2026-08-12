import { redirect } from 'next/navigation'

// The supplier root has no content of its own — the sections below it do.
export default async function SupplierIndex({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  redirect(`/suppliers/${encodeURIComponent(code)}/pending`)
}
