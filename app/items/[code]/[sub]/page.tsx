import { notFound } from 'next/navigation'
import ItemDetailPage from '../page'
import { familyFromSlug } from '@/lib/brand'

/**
 * /items/{brand}/{code} — an item number as ANOTHER manufacturer's part.
 *
 * The plain /items/{code} page is the ERP's view: PSA by default, MG behind
 * its prefix. When a Volvo or a Fiat prints the same number on its own cars,
 * the cross-brand card links here, and the same page renders that brand's
 * wording, cars and drawings with none of the ERP's figures (see
 * foreignBrandView in the item API).
 *
 * Next.js forbids a second slug name at the depth `[code]` already occupies,
 * so the first segment arrives as `code` and is read as the brand. A server
 * component, so an unknown brand is a real 404 rather than a page for a code
 * nobody asked for.
 */
export default async function BrandItemPage({ params }: { params: Promise<{ code: string; sub: string }> }) {
  const { code: brandSlug, sub } = await params
  if (!familyFromSlug(brandSlug)) notFound()
  return <ItemDetailPage params={Promise.resolve({ code: sub, brand: brandSlug.toLowerCase() })} />
}
