-- Demo store (Royer, October 8, 2026): nothing is sold, so the server keeps
-- no personal details. The order, its items, totals, payment status and the
-- country (for the tax label) stay; name, email, phone and street address
-- live only in the shopper's browser. Safe to run again.
alter table "audiophile_orders"
  drop column if exists "customer_name",
  drop column if exists "email",
  drop column if exists "phone",
  drop column if exists "address",
  drop column if exists "zip",
  drop column if exists "city";

create index if not exists "audiophile_orders_unpaid_age_idx"
  on "audiophile_orders" ("created_at")
  where "status" in ('pending_hosted', 'pending_transfer', 'pending_in_person', 'cancelled');

-- Fixed ten-minute windows per hashed client address or browser session.
-- Rows older than a day are removed by the daily purge.
create table if not exists "audiophile_rate_limits" (
  "bucket" text not null check ("bucket" ~ '^[0-9a-f]{64}$'),
  "window_start" timestamptz not null,
  "hits" integer not null check ("hits" > 0),
  primary key ("bucket", "window_start")
);
