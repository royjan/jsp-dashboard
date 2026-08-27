-- Xpart mirror tables.
--
-- Xpart-v2 (a separate app, on its own Supabase) is the procurement side of the
-- business: it holds the supplier price lists we never had here — 1.16M active
-- rows across 11 suppliers, plus the supersession chains its imports discovered.
-- We read that DB with a read-only login (XPART_DB_URL) and mirror the slice
-- that concerns parts the ERP actually knows about.
--
-- Our own prices are NOT touched by any of this: cost and retail keep coming
-- from FINAPI. These tables only ever add what suppliers charge us.

CREATE TABLE IF NOT EXISTS dashboard.xpart_syncs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  status              text NOT NULL DEFAULT 'running',   -- running | completed | failed
  erp_codes           integer NOT NULL DEFAULT 0,
  suppliers_upserted  integer NOT NULL DEFAULT 0,
  prices_upserted     integer NOT NULL DEFAULT 0,
  prices_removed      integer NOT NULL DEFAULT 0,
  chains_new          integer NOT NULL DEFAULT 0,
  new_parts_upserted  integer NOT NULL DEFAULT 0,
  error               text
);

-- One row per Xpart supplier. finansit_code is the join back to our own
-- dashboard.supplier_profiles.supplier_code / ERP supplier records; the three
-- suppliers Xpart tracks without an ERP account (Lubinski, ORLYD, SOEX) simply
-- carry NULL there.
CREATE TABLE IF NOT EXISTS dashboard.xpart_suppliers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  xpart_supplier_id   uuid NOT NULL UNIQUE,
  code                text NOT NULL,
  name                text NOT NULL,
  role                text,               -- wholesaler | official_distributor
  currency            text,
  default_price_term  text,
  payment_terms       text,
  lead_time_days      integer,
  finansit_code       text,
  finansit_price_code text,
  active              boolean NOT NULL DEFAULT true,
  synced_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS xpart_suppliers_finansit_code_idx
  ON dashboard.xpart_suppliers (finansit_code);

-- Current supplier price per (supplier, item). Not history: Xpart keeps 1.48M
-- price_history rows of its own, so mirroring history here would only duplicate
-- it. Rows the latest sync did not see are deleted, so a price list going
-- inactive upstream disappears here too.
CREATE TABLE IF NOT EXISTS dashboard.xpart_supplier_prices (
  id                  bigserial PRIMARY KEY,
  sync_id             uuid NOT NULL REFERENCES dashboard.xpart_syncs(id),
  item_code           text NOT NULL,
  supplier_code       text NOT NULL,
  supplier_name       text NOT NULL,
  -- Lubinski is the official PSA distributor: its list is the retail baseline
  -- we measure margin against, not a purchase option like the others.
  is_retail           boolean NOT NULL DEFAULT false,
  price               numeric NOT NULL,
  currency            text NOT NULL,
  fx_to_ils           numeric,
  import_markup       numeric,
  landed_ils          numeric,
  price_term          text,
  availability_status text,
  lead_time_days      integer,
  minimum_quantity    integer,
  price_list_name     text,
  effective_date      date,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS xpart_supplier_prices_supplier_item_uq
  ON dashboard.xpart_supplier_prices (supplier_code, item_code);
CREATE INDEX IF NOT EXISTS xpart_supplier_prices_item_idx
  ON dashboard.xpart_supplier_prices (item_code);
CREATE INDEX IF NOT EXISTS xpart_supplier_prices_sync_idx
  ON dashboard.xpart_supplier_prices (sync_id);

-- Supersession links Xpart's price-list imports discovered. in_erp records
-- whether FINAPI's own item_id_history already carried the link at sync time —
-- the rows where it is false are the ones this whole table exists for.
CREATE TABLE IF NOT EXISTS dashboard.xpart_chains (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_code          text NOT NULL,
  new_code          text NOT NULL,
  replacement_type  text,
  in_erp            boolean NOT NULL DEFAULT false,
  old_in_erp        boolean NOT NULL DEFAULT false,
  new_in_erp        boolean NOT NULL DEFAULT false,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS xpart_chains_pair_uq
  ON dashboard.xpart_chains (old_code, new_code);
CREATE INDEX IF NOT EXISTS xpart_chains_in_erp_idx
  ON dashboard.xpart_chains (in_erp) WHERE in_erp = false;

-- Part numbers our suppliers quote that have no ERP item code at all — the
-- catalog we could sell but have never opened a code for. in_retail_list means
-- the official distributor lists it, i.e. it is a real sellable PSA/Opel/MG part
-- rather than one wholesaler's private reference.
CREATE TABLE IF NOT EXISTS dashboard.xpart_new_parts (
  id                     bigserial PRIMARY KEY,
  part_number            text NOT NULL UNIQUE,
  brand                  text,
  description            text,
  supplier_count         integer NOT NULL DEFAULT 0,
  cheapest_supplier_code text,
  cheapest_price         numeric,
  cheapest_currency      text,
  cheapest_landed_ils    numeric,
  retail_ils             numeric,
  in_retail_list         boolean NOT NULL DEFAULT false,
  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS xpart_new_parts_rank_idx
  ON dashboard.xpart_new_parts (in_retail_list, supplier_count DESC);
