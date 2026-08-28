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
 *
 * SECTIONS ARE NAMED AFTER THE WORK, NOT AFTER THE SYSTEM. A section is where
 * someone looks when they have a job in hand, so the test for a new entry is
 * "which job is this part of", not "which table does it read". That is why
 * stock alerts live with stock rather than in a catch-all, and why supplier
 * invoices and supplier credits are one section apart from customer
 * receivables even though all three are money. The sidebar shows one section
 * expanded at a time, which makes a wrong home expensive: it is not a row in
 * the wrong place, it is a row nobody sees.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Activity, Bell, BookOpen, Bot, BotMessageSquare, Briefcase, Calendar,
  CalendarRange, CarFront, ClipboardList, Container, DollarSign, FileBarChart,
  FileSearch, FileText, FlaskConical, GitBranch, HeartPulse, Landmark,
  Languages, LayoutDashboard, Link2, ListRestart, MessageSquare,
  NotebookPen, Package, PackageCheck, PackageX, Percent, Radar, Receipt,
  ReceiptText, RotateCcw, Scale, SearchX, ShoppingBag, ShoppingCart, Sparkles,
  Sun, Sunrise, Swords, Target, ThumbsUp, Trash2, TrendingDown, Truck, Undo2,
  Users, Wallet, Warehouse,
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
  /**
   * A THIRD LEVEL: the screen's own in-page tabs, as nav rows.
   *
   * Several screens are really a small set of screens behind a tab strip --
   * /report has seven `?section=` tabs, /gap and /stock have sibling routes --
   * and none of that was visible from the sidebar. You had to already know
   * that credit notes live inside the business report to ever open them.
   *
   * A child is an ordinary NavItem, so it carries its own active test; what
   * makes it a child is only where it sits. The sidebar nests them under the
   * parent and shows them when that subtree is current; the palette and the
   * phone flatten them into real destinations (see `flatSectionsFor`).
   *
   * The rule for what belongs here is "a tab that changes WHICH screen you are
   * looking at", not "a tab that filters the one you are on" -- so /report's
   * sections qualify and the all/red/yellow/green chips on customer health do
   * not.
   */
  children?: NavItem[]
  /**
   * Dropped while demo mode masks money. /report hides its revenue-decline tab
   * then (the tab is literally titled "ירידה בהכנסות"), so a nav row for it
   * would be a link that silently lands on the summary instead.
   */
  demoHidden?: boolean
}

export type NavSection = { id: string; labelKey: TranslationKey; items: NavItem[] }

/**
 * One tab of /report. The seven sections are one page whose tab strip writes
 * `?section=`, so each is deep-linkable -- but usePathname() never returns the
 * query, hence matchHref + queryMatch (the same pair Diego and Dora need).
 */
const reportTab = (
  section: string,
  labelKey: TranslationKey,
  icon: LucideIcon,
  extra: Partial<NavItem> = {},
): NavItem => ({
  href: `/report?section=${section}`,
  matchHref: '/report',
  queryMatch: (p) => p.get('section') === section,
  labelKey,
  icon,
  // Short, ambiguous labels ('זיכויים' against 'זיכויי ספקים') read fine
  // indented under their parent and badly as a standalone tile on a phone.
  surfaces: ['sidebar', 'palette'],
  ...extra,
})

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
      {
        href: '/report',
        labelKey: 'report',
        icon: FileBarChart,
        // The bare /report IS the summary tab, so it must stop being active
        // once another section is selected or two rows light up at once.
        queryMatch: (p) => {
          const section = p.get('section')
          return !section || section === 'summary'
        },
        children: [
          reportTab('deadstock', 'deadStock', Package),
          reportTab('revenue', 'revenueDecline', TrendingDown, { demoHidden: true }),
          reportTab('seasonal', 'seasonalAnalysis', Calendar),
          reportTab('credits', 'creditNotes', FileText),
          reportTab('customers', 'customerAnalysis', Users),
          reportTab('recommendations', 'recommendations', Target),
        ],
      },
      // Moved out of the old 'operations' bucket. Neither is something you DO
      // -- they are things you look at to decide, which is what this section
      // is for. In operations they sat between shipments and stock alerts.
      { href: '/competitors', labelKey: 'competitors', icon: Swords },
      { href: '/vehicle-intelligence', labelKey: 'vehicleIntelligence', icon: CarFront },
    ],
  },
  {
    id: 'inventory', labelKey: 'sectionInventory', items: [
      {
        mobilePrimary: true, href: '/stock', labelKey: 'stock', icon: Warehouse,
        children: [{ href: '/stock/demand', labelKey: 'demand', icon: Activity }],
      },
      { href: '/stock-forecast', labelKey: 'stockForecast', icon: TrendingDown },
      // Catalog Links hidden from nav (route still reachable at /catalog-links)
      {
        // /gap and /gap/catalog were two sibling rows for what the page itself
        // presents as two tabs of one screen.
        href: '/gap', labelKey: 'gapAnalysis', icon: SearchX,
        children: [{ href: '/gap/catalog', labelKey: 'catalogGap', icon: PackageX }],
      },
      { href: '/scrap', labelKey: 'scrap', icon: Trash2 },
      { href: '/returns', labelKey: 'returns', icon: RotateCcw },
      // Recovered orphans. ~1,800 lines of working screens were reachable only
      // by typing the URL: /reorder had no inbound link anywhere in the repo
      // despite being listed as a feature in CLAUDE.md, and /catalog-links was
      // hidden from the sidebar on purpose but then had no other entry either.
      { href: '/reorder', labelKey: 'reorder', icon: ListRestart },
      // 'Stock alerts' -- it was filed under operations, one section away from
      // the stock it alerts about.
      { href: '/alerts', labelKey: 'alerts', icon: Bell },
      { href: '/catalog-links', labelKey: 'catalogLinks', icon: Link2, surfaces: ['palette'] },
    ],
  },
  {
    id: 'sales', labelKey: 'sectionSales', items: [
      {
        mobilePrimary: true, href: '/customers', labelKey: 'customers', icon: Users,
        // Health score is a tab of /customers and had no nav entry anywhere.
        children: [{ href: '/customers/health-score', labelKey: 'customerHealth', icon: HeartPulse }],
      },
      { href: '/receivables', labelKey: 'receivables', icon: Receipt },
      { href: '/margin', labelKey: 'margin', icon: Percent },
      { href: '/pricing', labelKey: 'pricing', icon: DollarSign },
      // One entry: /ebay and /ebay-reco are two tabs of the same screen.
      {
        href: '/ebay', labelKey: 'ebay', icon: ShoppingCart,
        // The tab strip on /ebay points at /ebay-reco/table, not /ebay-reco:
        // the view (table | map) is the last path segment.
        children: [{ href: '/ebay-reco/table', labelKey: 'ebayReco', icon: PackageCheck, match: 'prefix', matchHref: '/ebay-reco' }],
      },
      {
        href: '/sales-rep', labelKey: 'salesRep', icon: Briefcase,
        children: [{ href: '/sales-rep/price-check', labelKey: 'stockCheck', icon: DollarSign }],
      },
    ],
  },
  {
    // Was 'operations', which had become the bucket for anything that was not
    // clearly stock, sales or books: supplier paperwork sat beside competitor
    // pricing and stock alerts. What is left is one flow in its own order --
    // who we buy from, what they quote, what we asked, what they billed, what
    // they credited, what is on the way, what went out.
    id: 'purchasing', labelKey: 'sectionPurchasing', items: [
      { href: '/suppliers', labelKey: 'suppliers', icon: PackageCheck },
      { href: '/price-lists', labelKey: 'priceLists', icon: ClipboardList, match: 'prefix' },
      { href: '/inquiries', labelKey: 'supplierInquiries', icon: FileSearch, match: 'prefix' },
      { href: '/invoices', labelKey: 'supplierInvoices', icon: ReceiptText },
      { href: '/credits', labelKey: 'supplierCredits', icon: Undo2 },
      {
        href: '/shipments', labelKey: 'inboundShipments', icon: Container,
        // Its tab strip leads with 'on the way'; that screen had no nav entry.
        children: [{ href: '/shipments/on-the-way', labelKey: 'shipmentsOnTheWay', icon: Truck }],
      },
      { href: '/deliveries', labelKey: 'deliveries', icon: Truck },
      // Fullscreen phone view (see FULLSCREEN_PATHS) -- only meaningful on mobile.
      { href: '/deliveries/driver', labelKey: 'deliveriesDriver', icon: Truck, surfaces: ['mobile'] },
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
      {
        href: '/chat/flow-decisions', labelKey: 'chatFlowDecisions', icon: GitBranch,
        children: [
          { href: '/chat/flow-decisions/observatory', labelKey: 'chatFlowObservatory', icon: Radar },
        ],
      },
      { href: '/chat/word-mappings', labelKey: 'chatWordMappings', icon: Languages },
      { href: '/chat/parts-analytics', labelKey: 'chatPartsAnalytics', icon: Bot },
      {
        href: '/chat/diego',
        labelKey: 'chatDiego',
        icon: BotMessageSquare,
        // Shares a pathname with its Dora child, so it must also assert the
        // absence of ?view=dora or both would light up together.
        queryMatch: (p) => p.get('view') !== 'dora',
        children: [
          {
            href: '/chat/diego?view=dora',
            labelKey: 'chatCredits',
            icon: ReceiptText,
            matchHref: '/chat/diego',
            queryMatch: (p) => p.get('view') === 'dora',
          },
        ],
      },
      { href: '/chat/feedback', labelKey: 'chatFeedback', icon: ThumbsUp },

      { href: '/chat-insights', labelKey: 'chatInsights', icon: MessageSquare },
      { href: '/chat/simulator', labelKey: 'chatSimulator', icon: FlaskConical },
    ],
  },
]

/**
 * A child promoted to a flat surface, carrying the parent it came from so the
 * row can say "דוח עסקי › זיכויים" instead of a bare "זיכויים" that reads as a
 * sibling of "זיכויי ספקים".
 */
export type NavFlatItem = NavItem & { qualifierKey?: TranslationKey }

/** Every destination in the tree, parents immediately before their children. */
export const ALL_NAV_ITEMS: NavFlatItem[] = NAV_SECTIONS.flatMap((s) =>
  s.items.flatMap((item) => [
    item,
    ...(item.children ?? []).map((child) => ({ ...child, qualifierKey: item.labelKey })),
  ]),
)

function onSurface(item: NavItem, surface: NavSurface): boolean {
  return item.surfaces === undefined || item.surfaces.includes(surface)
}

/**
 * Sections as a TREE, filtered to one surface -- children stay nested under
 * their parent, and a parent filtered off a surface takes its children with
 * it. This is the sidebar's shape.
 */
export function sectionsFor(surface: NavSurface): NavSection[] {
  return NAV_SECTIONS
    .map((s) => ({
      ...s,
      items: s.items
        .filter((i) => onSurface(i, surface))
        .map((i) => (i.children ? { ...i, children: i.children.filter((c) => onSurface(c, surface)) } : i)),
    }))
    .filter((s) => s.items.length > 0)
}

/**
 * Sections FLATTENED -- every child promoted to a row of its own after its
 * parent. Surfaces with no room for a hierarchy (⌘K, the phone sheet) want
 * this: a child that only exists as a nested row is a screen those surfaces
 * cannot reach at all, which is the failure this file was written to end.
 */
export function flatSectionsFor(
  surface: NavSurface,
): Array<{ id: string; labelKey: TranslationKey; items: NavFlatItem[] }> {
  return NAV_SECTIONS
    .map((s) => ({
      ...s,
      items: s.items.flatMap((item) =>
        onSurface(item, surface)
          ? [
              item as NavFlatItem,
              ...(item.children ?? [])
                .filter((c) => onSurface(c, surface))
                .map((c) => ({ ...c, qualifierKey: item.labelKey })),
            ]
          : [],
      ),
    }))
    .filter((s) => s.items.length > 0)
}

/** Flat list for one surface, in tree order. */
export function itemsFor(surface: NavSurface): NavFlatItem[] {
  return flatSectionsFor(surface).flatMap((s) => s.items)
}

/** The phone bottom tabs. */
export const MOBILE_PRIMARY: NavFlatItem[] = itemsFor('mobile').filter((i) => i.mobilePrimary)

/**
 * Everything else on mobile. Explicitly excludes the primary tabs -- the "more"
 * sheet used to concatenate both lists and so showed those four twice.
 */
export const MOBILE_MORE: NavFlatItem[] = itemsFor('mobile').filter((i) => !i.mobilePrimary)

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
