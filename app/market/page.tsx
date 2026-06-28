import { redirect } from 'next/navigation'

// /market merged into the unified /vehicle-intelligence page.
export default function MarketPage() {
  redirect('/vehicle-intelligence')
}
