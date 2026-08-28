/**
 * The one place the navigation tree is defined.
 *
 * It used to live in four hand-maintained copies -- Sidebar (43 entries),
 * MobileNav (21), CommandPalette (24) and lib/route-titles.ts -- none of which
 * imported from the others. They drifted exactly as you would expect: the
 * palette could not reach 19 of the sidebar's destinations (no /suppliers, no
 * /shipments, no /deliveries, none of /chat/*), the mobile sheet repeated its
 * own four primary tabs, and four real screens totalling ~1,800 lines had no
 * entry on any surface at all.
 *
 * The fix is not "keep them in sync" but "stop having more than one". Every
 * surface derives from NAV_SECTIONS below, and an item appears on ALL surfaces
 * unless it opts out via `surfaces` -- so the default for a newly added screen
 * is reachable, and hiding one is a deliberate, visible act.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Bell, BookOpen, Bot, BotMessageSquare, Briefcase, CalendarRange,
  CarFront, ClipboardList, Container, DollarSign, FileBarChart, FileSearch,
  FlaskConical, GitBranch, Landmark, Languages, LayoutDashboard, Link2,
  ListRestart, MessageSquare, NotebookPen, PackageCheck, PackageX, Percent,
  Radar, Receipt, ReceiptText, RotateCcw, Scale, SearchX, ShoppingBag,
  ShoppingCart, Sparkles, Sun, Sunrise, Swords, ThumbsUp, Trash2,
  TrendingDown, Truck, Undo2, Users, Wallet, Warehouse,
} from 'lucide-react'
import type { TranslationKey } from '@/lib/i18n'

/** Where an entry may appear. Omitting `surfaces` means "all of them". */
export type NavSurface = 'sidebar' | 'mobile' | 'palette'

export type NavItem = {
  href: string
  labelKey: TranslationKey
  icon: LucideIcon
  /**
   * How the active state is decided. Every entry matched the pathname exactly
   * until bookkeeping arrived with sub-routes (/bookkeeping/vat ...), where an
   * exact match leaves the whole section unlit.
   */
  match?: 'exact' | 'prefix'
  /**
   * Pathname to compare against when it differs from `href` -- i.e. when the
   * href carries a query string. usePathname() never returns the query, so an
   * href like '/chat/diego?view=dora' could never equal the pathname and that
   * entry was permanently unlit while /chat/diego lit up in its place.
   */
  matchHref?: string
  /** Extra condition for two entries that share a pathname. */
  queryMatch?: (params: URLSearchParams) => boolean
  surfaces?: NavSurface[]
  /** One of the four bottom tabs on phones. */
  mobilePrimary?: boolean
  /**
   * Renders as a button that opens ⌘K instead of as a link. `href` is then only
   * a key and never navigated to -- smart search stopped being a page, and the
   * alternative to this flag was a second, parallel list of "nav entries that
   * are not links", which is the thing this file exists to prevent. Only
   * MobileNav honours it; the sidebar carries no action entries.
   */
  action?: 'command-palette'
}

export type NavSection = { id: string; labelKey: TranslationKey; items: NavItem[] }

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview', labelKey: 'sectionOverview', items: [
      { mobilePrimary: true, href: '/', labelKey: 'overview', icon: LayoutDashboard },
      { href: '/brief', labelKey: 'morningBrief', icon: Sunrise },
      // Not a route, and mobile-only: /search was a second search over the same
      // data, and ⌘K now asks both endpoints it asked. A phone has no ⌘K, so the
      // bottom tab opens the palette in place. The desktop sidebar does not
      // carry it -- the TopBar's search button is always on screen and says ⌘K
      // on its face -- and the palette does not list itself.
      { mobilePrimary: true, href: '#search', action: 'command-palette', labelKey: 'smartSearch', icon: Sparkles, surfaces: ['mobile'] },
      { href: '/seasonal', labelKey: 'seasonal', icon: Sun },
      { href: '/report', labelKey: 'report', icon: FileBarChart },
    ],
  },
  {
    id: 'inventory', labelKey: 'sectionInventory', items: [
      { mobilePrimary: true, href: '/stock', labelKey: 'stock', icon: Warehouse },
      { href: '/stock-forecast', labelKey: 'stockForecast', icon: TrendingDown },
      // Catalog Links hidden from nav (route still reachable at /catalog-links)
      { href: '/gap', labelKey: 'gapAnalysis', icon: SearchX },
      { href: '/gap/catalog', labelKey: 'catalogGap', icon: PackageX },
      { href: '/scrap', labelKey: 'scrap', icon: Trash2 },
      { href: '/returns', labelKey: 'returns', icon: RotateCcw },
      // Recovered orphans. ~1,800 lines of working screens were reachable only
      // by typing the URL: /reorder had no inbound link anywhere in the repo
      // despite being listed as a feature in CLAUDE.md, and /catalog-links was
      // hidden from the sidebar on purpose but then had no other entry either.
      { href: '/reorder', labelKey: 'reorder', icon: ListRestart },
      { href: '/catalog-links', labelKey: 'catalogLinks', icon: Link2, surfaces: ['palette'] },
    ],
  },
  {
    id: 'sales', labelKey: 'sectionSales', items: [
      { mobilePrimary: true, href: '/customers', labelKey: 'customers', icon: Users },
      { href: '/receivables', labelKey: 'receivables', icon: Receipt },
      { href: '/margin', labelKey: 'margin', icon: Percent },
      { href: '/pricing', labelKey: 'pricing', icon: DollarSign },
      // One entry: /ebay and /ebay-reco are two tabs of the same screen.
      { href: '/ebay', labelKey: 'ebay', icon: ShoppingCart },
      { href: '/sales-rep', labelKey: 'salesRep', icon: Briefcase },
      { href: '/sales-rep/price-check', labelKey: 'stockCheck', icon: DollarSign },
      // Tab of /ebay rather than its own destination, so it stays out of the
      // sidebar -- but it is a real screen and belongs in the palette.
      { href: '/ebay-reco', labelKey: 'ebayReco', icon: PackageCheck, surfaces: ['palette'] },
    ],
  },
  {
    id: 'operations', labelKey: 'sectionOperations', items: [
      { href: '/suppliers', labelKey: 'suppliers', icon: PackageCheck },
      { href: '/price-lists', labelKey: 'priceLists', icon: ClipboardList, match: 'prefix' },
      { href: '/inquiries', labelKey: 'supplierInquiries', icon: FileSearch, match: 'prefix' },
      { href: '/invoices', labelKey: 'supplierInvoices', icon: ReceiptText },
      { href: '/credits', labelKey: 'supplierCredits', icon: Undo2 },
      { href: '/competitors', labelKey: 'competitors', icon: Swords },
      { href: '/shipments', labelKey: 'inboundShipments', icon: Container },
      { href: '/deliveries', labelKey: 'deliveries', icon: Truck },
      // Fullscreen phone view (see FULLSCREEN_PATHS) -- only meaningful on mobile.
      { href: '/deliveries/driver', labelKey: 'deliveriesDriver', icon: Truck, surfaces: ['mobile'] },
      { href: '/vehicle-intelligence', labelKey: 'vehicleIntelligence', icon: CarFront },
      { href: '/alerts', labelKey: 'alerts', icon: Bell },
    ],
  },
  {
    // הנהח״ש — the books, decoded from the ERP's own files into books.*
    id: 'bookkeeping', labelKey: 'sectionBookkeeping', items: [
      { href: '/bookkeeping', labelKey: 'bookkeepingOverview', icon: BookOpen },
      { href: '/bookkeeping/accounts', labelKey: 'bookkeepingAccounts', icon: Landmark,
        match: 'prefix' },
      { href: '/bookkeeping/trial-balance', labelKey: 'bookkeepingTrialBalance', icon: Scale },
      { href: '/bookkeeping/journal', labelKey: 'bookkeepingJournal', icon: NotebookPen,
        match: 'prefix' },
      { href: '/bookkeeping/vat', labelKey: 'bookkeepingVat', icon: Percent },
      { href: '/bookkeeping/cash', labelKey: 'bookkeepingCash', icon: Wallet, match: 'prefix' },
      { href: '/bookkeeping/purchasing', labelKey: 'bookkeepingPurchasing', icon: ShoppingBag },
      { href: '/bookkeeping/years', labelKey: 'bookkeepingYears', icon: CalendarRange, surfaces: ['palette'] },
    ],
  },
  {
    // Chat admin (integrated from chat.jan.parts)
    id: 'chat', labelKey: 'sectionChat', items: [
      { href: '/chat/flow-decisions', labelKey: 'chatFlowDecisions', icon: GitBranch },
      { href: '/chat/flow-decisions/observatory', labelKey: 'chatFlowObservatory', icon: Radar },
      { href: '/chat/word-mappings', labelKey: 'chatWordMappings', icon: Languages },
      { href: '/chat/parts-analytics', labelKey: 'chatPartsAnalytics', icon: Bot },
      {
        href: '/chat/diego',
        labelKey: 'chatDiego',
        icon: BotMessageSquare,
        // Shares a pathname with the Dora entry below, so it must also assert
        // the absence of ?view=dora or both would light up together.
        queryMatch: (p) => p.get('view') !== 'dora',
      },
      { href: '/chat/feedback', labelKey: 'chatFeedback', icon: ThumbsUp },
      { href: '/chat-insights', labelKey: 'chatInsights', icon: MessageSquare },
      { href: '/chat/simulator', labelKey: 'chatSimulator', icon: FlaskConical },
      // merged into /chat/diego (Dora view); direct entry kept for muscle memory
      {
        href: '/chat/diego?view=dora',
        labelKey: 'chatCredits',
        icon: ReceiptText,
        matchHref: '/chat/diego',
        queryMatch: (p) => p.get('view') === 'dora',
      },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)

function onSurface(item: NavItem, surface: NavSurface): boolean {
  return item.surfaces === undefined || item.surfaces.includes(surface)
}

/** Sections filtered to one surface, dropping any left empty. */
export function sectionsFor(surface: NavSurface): NavSection[] {
  return NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => onSurface(i, surface)) }))
    .filter((s) => s.items.length > 0)
}

/** Flat list for one surface, in tree order. */
export function itemsFor(surface: NavSurface): NavItem[] {
  return ALL_NAV_ITEMS.filter((i) => onSurface(i, surface))
}

/** The phone bottom tabs. */
export const MOBILE_PRIMARY: NavItem[] = ALL_NAV_ITEMS.filter((i) => i.mobilePrimary)

/**
 * Everything else on mobile. Explicitly excludes the primary tabs -- the "more"
 * sheet used to concatenate both lists and so showed those four twice.
 */
export const MOBILE_MORE: NavItem[] = itemsFor('mobile').filter((i) => !i.mobilePrimary)

/**
 * Active-state test shared by every surface, so a route cannot read as active
 * in one place and inactive in another.
 *
 * `params` is null while the search params are still suspending; a queryMatch
 * entry stays unlit then rather than flashing the wrong sibling active.
 */
export function isItemActive(
  item: NavItem,
  pathname: string,
  params: URLSearchParams | null,
): boolean {
  const target = item.matchHref ?? item.href
  const pathHit = item.match === 'prefix'
    ? pathname === target || pathname.startsWith(`${target}/`)
    : pathname === target
  if (!pathHit) return false
  if (!item.queryMatch) return true
  return params !== null && item.queryMatch(params)
}
