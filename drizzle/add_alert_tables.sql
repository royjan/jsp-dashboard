-- Migration: add alert_rules and alert_firings tables
-- Apply via: psql $DATABASE_URL -f drizzle/add_alert_tables.sql
-- Or via drizzle-kit: npm run db:push

CREATE TABLE IF NOT EXISTS "dashboard"."alert_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "item_codes" text[],
  "top_n_months" integer,
  "top_n" integer,
  "threshold_qty" numeric NOT NULL DEFAULT '0',
  "comparator" varchar(10) NOT NULL DEFAULT 'lte',
  "recipients" text[] NOT NULL,
  "channel" varchar(20) NOT NULL DEFAULT 'email',
  "enabled" boolean NOT NULL DEFAULT true,
  "cooldown_hours" integer NOT NULL DEFAULT 24,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" varchar(255)
);

CREATE TABLE IF NOT EXISTS "dashboard"."alert_firings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id" uuid NOT NULL,
  "item_code" text NOT NULL,
  "item_name" text,
  "stock_qty" numeric NOT NULL,
  "threshold_qty" numeric NOT NULL,
  "fired_at" timestamptz NOT NULL DEFAULT now(),
  "notification_sent" boolean NOT NULL DEFAULT false,
  "error" text
);

CREATE INDEX IF NOT EXISTS "alert_firings_rule_item_fired_idx"
  ON "dashboard"."alert_firings" ("rule_id", "item_code", "fired_at");
