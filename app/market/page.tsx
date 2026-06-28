import { redirect } from 'next/navigation'

// /market merged into /vehicle-intelligence as the "Market" tab.
export default function MarketPage() {
  redirect('/vehicle-intelligence?tab=market')
}
