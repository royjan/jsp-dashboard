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
- **Data flow**: React Query hooks → API routes → Finansit SDK → Redis cache
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
- **Two snapshot tables exist**: `dashboard.item_snapshots` (2.6k rows, the synced one) and `dashboard.item_snapshot` (singular, **0 rows** — an empty SQLite-era leftover whose columns `qty`/`retail_price`/`ordered_qty` several old queries still reference). Neither is complete; `getItems()` (live FINAPI + Redis) is the authoritative item source.

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

## Dashboard Pages

| Page | Purpose |
|------|---------|
| Overview (`/`) | Sales trends, KPIs, YoY comparisons, demand scatter |
| Seasonal (`/seasonal`) | Item category heatmap by month, seasonal clustering |
| Stock (`/stock`) | Dead stock analysis, capital tied up, lifecycle view |
| Customers (`/customers`) | Top customers, churn analysis, revenue trends |
| Customer Detail (`/customers/[code]`) | Individual customer orders, aging, balance |
| Receivables (`/receivables`) | AR aging buckets, payment terms, overdue |
| Gap Analysis (`/gap`) | Items quoted but not in stock (supply chain gaps) |
| Scrap (`/scrap`) | Dead stock candidates, 4-year sales history |
| Reorder (`/reorder`) | AI-powered reorder recommendations |
