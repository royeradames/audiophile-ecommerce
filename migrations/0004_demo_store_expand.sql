-- Demo store, step 1 of 2 (expand). Applied BEFORE the demo-store code ships,
-- so the running code and the new code both work on it:
-- * personal-detail columns become optional (the new code stops writing them);
-- * the rate-limit table and the purge index appear.
-- Safe to run again, including on a database where step 2 already ran.
do $$
declare
  personal text;
begin
  foreach personal in array array['customer_name', 'email', 'phone', 'address', 'zip', 'city', 'country'] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = current_schema() and table_name = 'audiophile_orders' and information_schema.columns.column_name = personal
    ) then
      execute format('alter table "audiophile_orders" alter column %I drop not null', personal);
    end if;
  end loop;
end
$$;

create index if not exists "audiophile_orders_unpaid_age_idx"
  on "audiophile_orders" ("created_at")
  where "status" in ('pending_hosted', 'pending_transfer', 'pending_in_person', 'cancelled');

-- Fixed ten-minute windows per keyed hash of a client address or browser
-- session. Windows older than a day are removed by the daily purge.
create table if not exists "audiophile_rate_limits" (
  "bucket" text not null check ("bucket" ~ '^[0-9a-f]{64}$'),
  "window_start" timestamptz not null,
  "hits" integer not null check ("hits" > 0),
  primary key ("bucket", "window_start")
);
