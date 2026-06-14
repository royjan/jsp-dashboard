# Jan Parts Dashboard — Business Analytics

## Project Overview

Analytics dashboard for Jan Parts (Israeli auto-parts distributor). Provides real-time KPIs, sales trends, customer analytics, inventory optimization, and seasonal demand patterns — all sourced from the Finansit ERP via `@jan/finansit-sdk`.

Live at `dashboard.jan.parts`.

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
  sqlite.ts                   # SQLite read-only historical queries
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
  dashboard-history.db        # SQLite local cache (~140MB, read-only)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| UI | Radix UI + Tailwind CSS 4 + Framer Motion |
| Charts | Recharts |
| Data Fetching | TanStack React Query |
| ERP API | @jan/finansit-sdk (centralized SDK) |
| Database | PostgreSQL (Neon) via Drizzle ORM + SQLite (local historical cache) |
| Cache | Upstash Redis (3h TTL, 48h for seasonal) |
| AI | Google Gemini (reorder recommendations, insights) |
| Deploy | Docker → AWS ECR → AWS App Runner |
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
- **Cron** (`/api/cron/warm-cache`): Runs every 2h during business hours
- **SQLite** (`data/dashboard-history.db`): Historical snapshots, read-only, 32MB memory cache

## Database

- **PostgreSQL (Neon)**: Synced data via `/api/sync` — `dashboard.monthly_sales`, `dashboard.daily_sales`, `dashboard.item_snapshots`, `dashboard.documents`
- **ORM**: Drizzle ORM (`drizzle-orm/node-postgres`). Schema at `lib/db/schema.ts`, config at `drizzle.config.ts`. Upserts use Drizzle query builder; complex analytics/cross-table queries use raw SQL via `query()`.
- **SQLite**: Read-only local cache for cross-year historical comparisons. Auto-converts PostgreSQL syntax.

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

```bash
./deploy.sh [tag]    # Build Docker → push ECR → update App Runner
```

- Registry: AWS ECR (`224072612352.dkr.ecr.eu-central-1.amazonaws.com`)
- Service: AWS App Runner (`jan-parts-dashboard`)
- Domain: `dashboard.jan.parts` (Route 53 CNAME)
- Region: eu-central-1
- Docker: Node 25 Alpine, multi-stage build, runs as non-root user
- CodeArtifact auth required for `@jan/finansit-sdk` during build

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
