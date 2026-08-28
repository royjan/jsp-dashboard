# Jan Parts Dashboard — Business Analytics

## Project Overview

Analytics dashboard for Jan Parts (Israeli auto-parts distributor). Provides real-time KPIs, sales trends, customer analytics, inventory optimization, and seasonal demand patterns — all sourced from the Finansit ERP via `@jan/finansit-sdk`.

Runs on Dokploy at `192.168.0.112:3002` (see Deployment). **Not**
`dashboard.jan.parts` — that was the AWS App Runner host and is retired, but
this line said otherwise for a while and sent code to a dead URL.

## Architecture

```
app/                          # Next.js 16 App Router pages
  page.tsx                    # Overview dashboard (KPIs, sales trends)
  customers/                  # Customer analytics
    [code]/page.tsx           # Individual customer details
  receivables/                # AR aging analysis
  gap/                        # Gap analysis (quoted but not in stock)
  scrap/                      # Dead stock & capital tied analysis
  sales/                      # Sales analytics
  stock/                      # Stock optimization
  seasonal/                   # Seasonal demand heatmaps
  conversion/                 # Document conversion analytics
  reorder/                    # AI reorder recommendations
  report/                     # Reports page
  api/
    init/                     # AWS Secrets initialization
    sync/                     # Data sync from Finansit ERP
    dashboard/                # KPI endpoint
    customers/                # Customer data
    items/                    # Item search & history
    stock/                    # Stock levels
    documents/                # Documents
    analytics/*/              # Analytics query endpoints
    ai/*/                     # Gemini AI insight endpoints
    cron/                     # Scheduled cache warming

components/
  layout/                     # Shell, sidebar, topbar, mobile nav
  charts/                     # Recharts visualizations
  dashboard/                  # KPI cards
  shared/                     # DatePicker, AnimatedCounter, PeriodSelector
  ui/                         # Radix UI component library

lib/
  finansit-client.ts          # Thin wrapper over @jan/finansit-sdk
  db.ts                       # PostgreSQL (Neon) connection + Drizzle ORM instance
  db/
    schema.ts                 # Drizzle schema (4 tables in `dashboard` schema)
  neon-read.ts                # Read helper for Neon + toPg() shim for legacy SQLite-style SQL
  services/
    analytics-service.ts      # Data aggregation & calculations
  i18n.ts                     # Hebrew/English translations
  aws-secrets.ts              # AWS Secrets Manager
  redis-client.ts             # Upstash Redis caching
  gemini.ts                   # Google Gemini AI integration

hooks/
  use-analytics.ts            # React Query hooks for analytics
  use-dashboard.ts            # Dashboard data hooks
  use-url-params.ts           # URL parameter management

data/
  dashboard-history.db        # LEGACY, unused — leftover SQLite mirror, gitignored, not in the image
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| UI | Radix UI + Tailwind CSS 4 + Framer Motion |
| Charts | Recharts |
| Data Fetching | TanStack React Query |
| ERP API | @jan/finansit-sdk (centralized SDK) |
| Database | PostgreSQL (Neon) via Drizzle ORM |
| Cache | Upstash Redis (3h TTL, 48h for seasonal) |
| AI | Google Gemini (reorder recommendations, insights) |
| Deploy | Dokploy (builds from `main` via Dockerfile) |
| Secrets | AWS Secrets Manager |
| i18n | Hebrew (RTL primary), English |

## Key Conventions

- **Path alias**: `@/*` maps to project root
- **Components**: PascalCase `.tsx`, Radix UI + Tailwind + CVA
- **Hooks**: `use-*` pattern in `/hooks`
- **i18n**: All UI text uses translation keys, Hebrew primary
- **Data flow**: React Query hooks → API routes → Finansit SDK → Redis cache.
  This is the intended pattern and what new code should follow, but be aware
  three conventions coexist today: shared hooks in `/hooks` (~35 pages), inline
  `useQuery` with the fetch written in the page (~22), and plain
  `useEffect` + `fetch` + `useState` with no React Query at all (~28, including
  `/stock`, `/competitors` and `/stock-forecast`). Prefer the hooks; convert
  rather than extend the other two.
- **Colour**: semantic tokens (`--success`/`--warning`/`--info`) and chart
  series (`--chart-1..8`) are defined per theme in `app/globals.css`. Use them
  rather than raw Tailwind palette classes — a `text-emerald-500` has no dark
  counterpart unless you write one, which is how ~2,600 unpaired palette
  utilities accumulated. Chart series come from `lib/chart-colors.ts`
  (`seriesColor(i)`, which never cycles); never wrap a token in `hsl()`, the
  values are hex and `hsl(var(--x))` renders no mark at all.
- **Page titles**: `components/shared/PageHeader.tsx`, not a hand-rolled `<h1>`.
- **Standalone output**: Docker-optimized Next.js build

## Finansit SDK Integration

Central data source. The dashboard wraps `@jan/finansit-sdk` in `lib/finansit-client.ts`:

- Items: catalog, stock levels, pricing, history chains
- Stock: per-warehouse inventory, incoming/ordered quantities
- Documents: invoices (format 11), quotes (31), delivery notes (21)
- Customers: details, balance, aging buckets, receipts, orders
- Dashboard: KPIs (open quotes, invoices, monthly sales)

Credentials from AWS Secrets Manager (`FINANSIT_API_CREDENTIALS`).

## Caching Strategy

- **Redis (3h TTL)**: Dashboard KPIs, item lists, document headers, analytics
- **Redis (48h TTL)**: Seasonal data (changes infrequently)
- **Redis (2h TTL)**: AI insights
- **Cron** (`/api/cron/warm-cache`): Runs every 2h during business hours. Keep a route's TTL >= the warm interval, or users hit the cold path between runs (that's what made `/receivables` look stuck at ~216s).

## Database

- **PostgreSQL (Neon)**: Synced data via `/api/sync` — `dashboard.monthly_sales`, `dashboard.daily_sales`, `dashboard.item_snapshots`, `dashboard.documents`
- **ORM**: Drizzle ORM (`drizzle-orm/node-postgres`). Schema at `lib/db/schema.ts`, config at `drizzle.config.ts`. Upserts use Drizzle query builder; complex analytics/cross-table queries use raw SQL via `query()`.
- **SQLite is gone.** Reads go straight to Neon via `readQueryAsync` (`lib/neon-read.ts`), which runs a `toPg()` shim over legacy SQLite-flavoured SQL. **The shim is partial** — it rewrites `strftime('%Y'|'%m')`, `?` params and a fixed list of bare table names, and nothing else. Anything it misses (`strftime('%w')`, two-argument `MIN()`/`MAX()`, SQLite's lax `GROUP BY`, an unlisted table) throws at runtime, and routes that wrap queries in a `safeQuery`-style catch turn that into **zeros on screen instead of an error**. Prefer plain Postgres or Drizzle in new code; when touching an old query, convert it rather than extending the shim.
- **`dashboard.documents.year` is the FISCAL-YEAR DATABASE the row was archived from, NOT the year of `doc_date`.** A document still open when Btrieve rolls over gets archived again from the next year's database, so it exists twice under two `year` values: 188,720 format-11 rows hold only 158,361 distinct `doc_number`. Every one of 2025's 20,273 invoices also sits under `year=2026`; 2024 and 2023 overlap too. **Never `GROUP BY year` and never `SUM` this table without deduping** — doing both reported 2026 revenue as 16.3M (12.3M of it 2025's) against a 15.1M "2025", a fabricated +8% on a flat year, and separately inflated `daily_sales` 2023 to 21.7M (true 18.1M) and 2024 to 20.1M (true 16.8M). The safe shape, `(format, doc_number)` being globally unique:
  ```sql
  SELECT DISTINCT ON (format, doc_number) ... FROM dashboard.documents
  WHERE doc_date IS NOT NULL ORDER BY format, doc_number, year DESC
  ```
  then bucket on `EXTRACT(YEAR FROM doc_date)`. Also note the half-loaded 2026 rows carry `grand_total = 0` on 2,099 of 7,147, so the current year cannot be read from the archive on a gross basis at all — it belongs to FINAPI.
- **`dashboard.daily_sales` is the shared revenue source** for both `/report` and `/brief`, gross of VAT (`grand_total`), format 11 only. Closed years come from the deduped archive (`/api/sync?mode=backfill-docs`, which is bounded to `doc_date < DATE_TRUNC('year', CURRENT_DATE)`); **the active year comes from FINAPI** and must never be restated from the archive. Writes go through `lib/services/daily-sales-sync.ts` — always fetch a DATE RANGE, never "the newest N invoices": the upsert REPLACES a day's total, so a count-bounded window rewrites its oldest days with a fraction of themselves. That is what recorded July 2026 as 316 invoices / ₪196,028 against a real ~1,700 / ₪1.2M, and made the morning brief report the year down 14% when it was down 2%.
- **Two snapshot tables exist**: `dashboard.item_snapshots` (2.6k rows, the synced one) and `dashboard.item_snapshot` (singular, **0 rows** — an empty SQLite-era leftover whose columns `qty`/`retail_price`/`ordered_qty` several old queries still reference). Neither is complete; `getItems()` (live FINAPI + Redis) is the authoritative item source.

### ⚠️ YEAR-END ACTION — archive the closing fiscal year (do this every January)

**Run the document sync for the whole closing year before Btrieve rolls over.** Once Finansit
advances to `j2027`, fiscal 2026 is queryable ONLY if it was archived into
`dashboard.documents` / `dashboard.document_lines` first.

This is the one thing the stalled sync actually costs. Jan Parts runs a deliberate split
(benchmarked 2026-08-16): **active year live from Finansit/Btrieve, closed years from
Postgres** — so the loader stopping mid-year is harmless day to day, because the active year
should never be served from Postgres anyway. It is only fatal at the boundary.

State as of 2026-08-16: the loader is **stopped**. `dashboard.documents` ends 2026-05-12 and
`dashboard.etl_watermarks.daily_documents_2026` has not moved since 2026-05-13, so 2026 is
half-archived (Jan–May). **The year-end run must cover the WHOLE year, not resume from the
watermark.**

- **Do NOT delete these tables.** They are the historical archive FINAPI reads for every
  closed year — 741,613 documents back to 2001-10-12. `/api/documents/lines?year=2025`
  answers 200 because of them.
- **They are verified accurate.** Cross-checked against Btrieve over five items on
  2026-08-16: 40 lines matched on (format, doc_number) with **zero** quantity and **zero**
  line-total mismatches, and nothing present in Postgres that Btrieve lacked.
- **Fix while you are in there:** `document_lines.doc_date` is NULL on all 541,366 rows, so
  every PG-served line returns `doc_date`/`customer_code`/`customer_name` as empty strings.
  Only the money columns are populated.

```bash
npm run db:push        # Push schema changes to DB
npm run db:generate    # Generate migrations
npm run db:migrate     # Run migrations
npm run db:studio      # Open Drizzle Studio
```

## Development

```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
```

## Environment Variables

- `FINANSIT_API_CREDENTIALS` — `email:api_key` for ERP API
- `DATABASE_URL` — Neon PostgreSQL connection

AWS Secrets Manager provides these in production. Override locally via `.env.local`.

## Deployment

Production runs on **Dokploy** (self-hosted at `192.168.0.112:3000`; the dashboard
app serves on `:3002`). Dokploy builds from the `main` branch via the repo's
`Dockerfile` — so **push to `main`, then trigger a deploy**:

```bash
# push, then hit the app's deploy WEBHOOK. NOTE: /api/application.deploy now
# returns 200 but silently does NOTHING for github-sourced apps (verified
# 2026-08-07 — no deployment row is created). The webhook requires a
# GitHub-shaped request or it answers "Branch Not Match":
git push origin main
RT=$(curl -s -H "x-api-key: $(cat ~/.config/dokploy/api-token)" \
  'http://192.168.0.112:3000/api/application.one?applicationId=fS6YxDi2AGcFvYIdaOtAJ' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["refreshToken"])')
curl -X POST -H "Content-Type: application/json" -H "X-GitHub-Event: push" \
  -d '{"ref":"refs/heads/main"}' \
  "http://192.168.0.112:3000/api/deploy/$RT"
# then poll /api/deployment.all for TODAY'S row reaching done — polling
# applicationStatus alone reads the PREVIOUS deploy's "done" and lies.
# (No GitHub webhook is configured on the repo, so pushes do NOT auto-deploy.)
```

- Build: Node 25 Alpine multi-stage Dockerfile, runs as non-root user
- CodeArtifact auth required for `@jan/finansit-sdk` during build
- The former AWS App Runner + ECR path (`dashboard.jan.parts`) is retired

**Verify a deploy against the running thing, never the tool's own report.**
On 2026-08-15 four deploys across this stack reported success while shipping
nothing: a green CI `deploy` job over a swarm service that never moved, Dokploy's
`application.update` + `.deploy` returning 200 while only its own DB row changed,
`docker service update` printing "converged" with the spec unchanged (needed
`--force`), and `./deploy.sh` exiting 0 because the real failure — "Cannot
connect to the Docker daemon" — was swallowed by a `tail` in the pipeline.

So after any deploy, check the artefact itself:

```bash
ssh jan-box "sudo docker service ls | grep -E 'partly|dashboard'"   # spec image
ssh jan-box "sudo docker ps --format '{{.Image}} | {{.Status}}'"    # what's live
```

and `set -o pipefail` before piping a deploy script into `tail`, or you read the
wrong exit code.

## Dashboard Pages

**84 `page.tsx` files — about 60 real screens** once the 10 redirect stubs and
the thin shells are discounted. The table below used to list nine and was read
as the whole app; it is a map of the main areas, not an inventory. The
authoritative list is `lib/navigation.ts`, which every nav surface derives from.

| Area | Screens |
|------|---------|
| Overview | `/` `/brief` `/seasonal` `/report` (smart search is ⌘K, not a route) |
| Inventory | `/stock` `/stock/demand` `/stock-forecast` `/gap` `/gap/catalog` `/scrap` `/returns` `/reorder` `/catalog-links` |
| Sales | `/customers` (+`/[code]`, `/health-score`) `/receivables` `/margin` `/pricing` `/ebay` `/ebay-reco` `/sales-rep/*` |
| Operations | `/suppliers/*` `/price-lists` `/inquiries` `/invoices` `/credits` `/competitors` `/shipments` `/deliveries` `/vehicle-intelligence` `/alerts` |
| Bookkeeping | `/bookkeeping` + accounts, trial-balance, journal, vat, cash, purchasing, years |
| Chat admin | `/chat/*` (flow-decisions, observatory, word-mappings, parts-analytics, diego, feedback, simulator) + `/chat-insights` |

**Navigation lives in one place: `lib/navigation.ts`.** Sidebar, MobileNav and
CommandPalette all derive from it, and an entry appears on every surface unless
it opts out via `surfaces`. Add a screen there or it is unreachable — which is
how `/reorder`, `/chat-insights`, `/catalog-links` and `/bookkeeping/years`
ended up as ~1,800 lines nothing linked to.

