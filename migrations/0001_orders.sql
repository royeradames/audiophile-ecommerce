-- Durable orders. Every statement is safe to run again: tables, indexes and
-- checks are created only when missing, and nothing is dropped or rewritten.
-- Money is integer US cents. Totals are calculated by the server from the
-- catalog; the browser never supplies a price.

create table if not exists "audiophile_orders" (
  "id" text primary key check ("id" ~ '^AUD-[0-9A-HJKMNP-TV-Z]{10}$'),
  -- One checkout submission creates one order, however often it is retried.
  "request_key" uuid not null unique,
  -- The signed-in customer's local principal, or null for guest checkout.
  "customer_id" text,
  "status" text not null check ("status" in (
    'pending_hosted', 'pending_transfer', 'pending_in_person',
    'paid', 'in_person_collected', 'cancelled'
  )),
  "payment_method" text not null check ("payment_method" in ('hosted', 'element', 'transfer', 'zelle', 'in_person')),
  "pickup_city" text not null default '' check ("pickup_city" in ('', 'santo_domingo', 'santiago')),
  "customer_name" text not null check (length("customer_name") between 1 and 200),
  "email" text not null check (length("email") between 3 and 254),
  "phone" text not null check (length("phone") between 1 and 60),
  "address" text not null check (length("address") between 1 and 300),
  "zip" text not null check (length("zip") between 1 and 30),
  "city" text not null check (length("city") between 1 and 120),
  "country" text not null check (length("country") between 1 and 120),
  "currency" text not null default 'usd' check ("currency" = 'usd'),
  "subtotal_cents" integer not null check ("subtotal_cents" > 0),
  "shipping_cents" integer not null check ("shipping_cents" >= 0),
  "tax_cents" integer not null check ("tax_cents" >= 0),
  "total_cents" integer not null check ("total_cents" = "subtotal_cents" + "shipping_cents" + "tax_cents"),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "settled_at" timestamptz
);

create index if not exists "audiophile_orders_customer_idx"
  on "audiophile_orders" ("customer_id", "created_at" desc)
  where "customer_id" is not null;

create index if not exists "audiophile_orders_paid_idx"
  on "audiophile_orders" ("settled_at" desc)
  where "status" = 'paid';

create table if not exists "audiophile_order_items" (
  "order_id" text not null references "audiophile_orders" ("id") on delete cascade,
  "product_id" text not null,
  "name" text not null,
  "quantity" integer not null check ("quantity" between 1 and 99),
  "unit_price_cents" integer not null check ("unit_price_cents" > 0),
  "position" integer not null check ("position" >= 0),
  primary key ("order_id", "product_id")
);

-- Payment status is keyed to the Stripe PaymentIntent. An order can collect
-- several attempts (a canceled card form, a later retry). The first success
-- settles the order; a second success stays recorded here for a refund.
create table if not exists "audiophile_payments" (
  "payment_intent_id" text primary key check ("payment_intent_id" ~ '^pi_[A-Za-z0-9_]+$'),
  "order_id" text not null references "audiophile_orders" ("id") on delete cascade,
  "checkout_session_id" text unique check ("checkout_session_id" ~ '^cs_[A-Za-z0-9_]+$'),
  "status" text not null check (length("status") between 1 and 40),
  "amount_cents" integer not null check ("amount_cents" > 0),
  "currency" text not null check ("currency" = 'usd'),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create index if not exists "audiophile_payments_order_idx"
  on "audiophile_payments" ("order_id", "created_at" desc);

-- Hosted Checkout sessions started for an order. Before a new one starts,
-- the earlier ones are expired, so only one hosted page can take payment.
create table if not exists "audiophile_checkout_sessions" (
  "session_id" text primary key check ("session_id" ~ '^cs_[A-Za-z0-9_]+$'),
  "order_id" text not null references "audiophile_orders" ("id") on delete cascade,
  "created_at" timestamptz not null default now()
);

create index if not exists "audiophile_checkout_sessions_order_idx"
  on "audiophile_checkout_sessions" ("order_id", "created_at" desc);

-- Stripe retries webhooks. Each event id is handled once.
create table if not exists "audiophile_stripe_events" (
  "event_id" text primary key check ("event_id" ~ '^evt_[A-Za-z0-9_]+$'),
  "type" text not null,
  "order_id" text,
  "received_at" timestamptz not null default now()
);
