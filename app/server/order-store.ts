import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { NewOrder, OrderSummary } from "../order-api";
import { initialStatus, type OrderStatus } from "../order-record";
import type { PaymentMethod, PickupCity } from "../payment-methods";
import { priceCart } from "../payment-request";

export type Transaction = Pick<pg.PoolClient, "query">;

/** Runs `work` in one transaction; any throw rolls it back. */
export async function inTransaction<T>(pool: pg.Pool, work: (tx: Transaction) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Crockford base32 without I, L, O, U: 10 symbols carry 50 random bits.
const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const durableOrderId = /^AUD-[0-9A-HJKMNP-TV-Z]{10}$/;

export function newOrderId() {
  const bytes = randomBytes(10);
  return "AUD-" + [...bytes].map((byte) => ID_ALPHABET[byte & 31]).join("");
}

type OrderRow = {
  id: string;
  request_key: string;
  customer_id: string | null;
  status: OrderStatus;
  payment_method: PaymentMethod;
  pickup_city: PickupCity | "";
  subtotal_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  created_at: Date;
  settled_at: Date | null;
};

type ItemRow = { order_id: string; product_id: string; name: string; quantity: number; unit_price_cents: number };

/**
 * An order plus the fields the server checks but never returns. This is a
 * demo store: no name, email, phone or address is ever stored here.
 */
export type StoredOrder = OrderSummary & { customerId: string | null; totalCents: number };

const orderColumns = `"id", "request_key", "customer_id", "status", "payment_method", "pickup_city",
  "subtotal_cents", "shipping_cents", "tax_cents", "total_cents", "created_at", "settled_at"`;

function toStored(row: OrderRow, items: ItemRow[]): StoredOrder {
  return {
    id: row.id,
    status: row.status,
    payment: row.payment_method,
    pickupCity: row.pickup_city,
    createdAt: row.created_at.toISOString(),
    settledAt: row.settled_at ? row.settled_at.toISOString() : null,
    lines: items.map((item) => ({
      productId: item.product_id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price_cents / 100,
    })),
    subtotal: row.subtotal_cents / 100,
    shipping: row.shipping_cents / 100,
    vat: row.tax_cents / 100,
    grandTotal: row.total_cents / 100,
    savedToAccount: row.customer_id !== null,
    customerId: row.customer_id,
    totalCents: row.total_cents,
  };
}

/** The public view: no customer ID. */
export function toSummary(order: StoredOrder): OrderSummary {
  return {
    id: order.id,
    status: order.status,
    payment: order.payment,
    pickupCity: order.pickupCity,
    createdAt: order.createdAt,
    settledAt: order.settledAt,
    lines: order.lines,
    subtotal: order.subtotal,
    shipping: order.shipping,
    vat: order.vat,
    grandTotal: order.grandTotal,
    savedToAccount: order.savedToAccount,
  };
}

async function loadItems(db: Transaction, ids: string[]) {
  if (!ids.length) return new Map<string, ItemRow[]>();
  const { rows } = await db.query<ItemRow>(
    `select "order_id", "product_id", "name", "quantity", "unit_price_cents"
       from "audiophile_order_items" where "order_id" = any($1::text[]) order by "position"`,
    [ids],
  );
  const byOrder = new Map<string, ItemRow[]>();
  for (const row of rows) byOrder.set(row.order_id, [...(byOrder.get(row.order_id) ?? []), row]);
  return byOrder;
}

async function withItems(db: Transaction, rows: OrderRow[]) {
  const items = await loadItems(db, rows.map((row) => row.id));
  return rows.map((row) => toStored(row, items.get(row.id) ?? []));
}

export async function getOrder(db: Transaction, id: string): Promise<StoredOrder | null> {
  if (!durableOrderId.test(id)) return null;
  const { rows } = await db.query<OrderRow>(`select ${orderColumns} from "audiophile_orders" where "id" = $1`, [id]);
  return (await withItems(db, rows))[0] ?? null;
}

export async function listCustomerOrders(db: Transaction, customerId: string) {
  const { rows } = await db.query<OrderRow>(
    `select ${orderColumns} from "audiophile_orders" where "customer_id" = $1 order by "created_at" desc limit 50`,
    [customerId],
  );
  return withItems(db, rows);
}

export async function listPaidOrders(db: Transaction) {
  const { rows } = await db.query<{ id: string; settled_at: Date; payment_method: string }>(
    `select "id", "settled_at", "payment_method" from "audiophile_orders"
      where "status" = 'paid' order by "settled_at" desc limit 200`,
  );
  return rows.map((row) => ({ orderId: row.id, paidAt: row.settled_at.toISOString(), source: row.payment_method }));
}

export type CreateOrderResult =
  | { ok: true; order: StoredOrder; replayed: boolean }
  | { ok: false; status: number; error: string };

function sameSubmission(existing: StoredOrder, input: NewOrder, customerId: string | null) {
  const requested = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
  const stored = [...existing.lines].sort((a, b) => a.productId.localeCompare(b.productId));
  return existing.payment === input.payment &&
    existing.customerId === customerId &&
    requested.length === stored.length &&
    requested.every((item, index) => item.productId === stored[index].productId && item.quantity === stored[index].quantity);
}

/**
 * Creates the order from server-calculated totals before any payment starts.
 * Retrying the same submission (same request key) returns the same order.
 * The request carries no personal details at all: name, email, phone and
 * address stay in the shopper's browser (demo store).
 */
export async function createOrder(pool: pg.Pool, input: NewOrder, customerId: string | null): Promise<CreateOrderResult> {
  const priced = priceCart(input.items);
  if (!priced.ok) return priced;
  const cents = (dollars: number) => Math.round(dollars * 100);

  return inTransaction(pool, async (tx) => {
    const inserted = await tx.query<OrderRow>(
      `insert into "audiophile_orders" ("id", "request_key", "customer_id", "status", "payment_method", "pickup_city",
          "subtotal_cents", "shipping_cents", "tax_cents", "total_cents")
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict ("request_key") do nothing
        returning ${orderColumns}`,
      [
        newOrderId(), input.requestKey, customerId, initialStatus(input.payment), input.payment, input.pickupCity,
        cents(priced.totals.subtotal), cents(priced.totals.shipping), cents(priced.totals.tax), priced.amountCents,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      const existing = await tx.query<OrderRow>(
        `select ${orderColumns} from "audiophile_orders" where "request_key" = $1`, [input.requestKey]);
      const order = (await withItems(tx, existing.rows))[0];
      if (!order || !sameSubmission(order, input, customerId)) {
        return { ok: false, status: 409, error: "This checkout was already submitted with different details. Reload checkout and try again." };
      }
      return { ok: true, order, replayed: true };
    }
    for (const [position, line] of priced.lines.entries()) {
      await tx.query(
        `insert into "audiophile_order_items" ("order_id", "product_id", "name", "quantity", "unit_price_cents", "position")
          values ($1, $2, $3, $4, $5, $6)`,
        [row.id, line.productId, line.name, line.quantity, cents(line.unitPrice), position],
      );
    }
    return { ok: true, order: (await withItems(tx, [row]))[0], replayed: false };
  });
}

/**
 * Card attempts whose outcome Stripe may have changed since we last heard:
 * anything not already known to be finished. Newest first.
 */
export async function openAttempts(db: Transaction, orderId: string) {
  const { rows } = await db.query<{ payment_intent_id: string; amount_cents: number }>(
    `select "payment_intent_id", "amount_cents" from "audiophile_payments"
      where "order_id" = $1 and "status" not in ('succeeded', 'canceled') and "checkout_session_id" is null
      order by "created_at" desc limit 10`,
    [orderId],
  );
  return rows;
}

export async function checkoutSessionsFor(db: Transaction, orderId: string) {
  const { rows } = await db.query<{ session_id: string }>(
    `select "session_id" from "audiophile_checkout_sessions" where "order_id" = $1 order by "created_at" desc limit 10`,
    [orderId],
  );
  return rows.map((row) => row.session_id);
}

export async function recordCheckoutSession(db: Transaction, orderId: string, sessionId: string) {
  await db.query(
    `insert into "audiophile_checkout_sessions" ("session_id", "order_id") values ($1, $2) on conflict do nothing`,
    [sessionId, orderId],
  );
}

/** Orders that more than one payment succeeded for: staff must refund the extra. */
export async function listDoublePaidOrders(db: Transaction) {
  const { rows } = await db.query<{ order_id: string; payments: number }>(
    `select "order_id", count(*)::int as "payments" from "audiophile_payments"
      where "status" = 'succeeded' group by "order_id" having count(*) > 1 order by "order_id" limit 200`,
  );
  return rows.map((row) => ({ orderId: row.order_id, payments: row.payments }));
}

export async function countAttempts(db: Transaction, orderId: string) {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as "count" from "audiophile_payments" where "order_id" = $1`, [orderId]);
  return rows[0].count;
}

export type StripePayment = {
  orderId: string;
  paymentIntentId: string;
  checkoutSessionId: string | null;
  /** Stripe's PaymentIntent status, or "succeeded" for a paid Checkout session. */
  status: string;
  amountCents: number;
  currency: string;
  livemode: boolean;
};

export type SettleOutcome =
  | "paid" | "already_paid" | "recorded" | "unknown_order" | "amount_mismatch" | "not_payable" | "foreign_intent" | "live_blocked";

/**
 * Records a Stripe payment attempt and, on success, settles the order once.
 * Safe to repeat: the webhook, the return page and a retry may all report the
 * same payment, in any order.
 */
export async function settleStripePayment(tx: Transaction, payment: StripePayment): Promise<SettleOutcome> {
  if (payment.livemode) return "live_blocked";
  const { rows } = await tx.query<{ status: OrderStatus; total_cents: number }>(
    `select "status", "total_cents" from "audiophile_orders" where "id" = $1 for update`, [payment.orderId]);
  const order = rows[0];
  if (!order) {
    console.error(JSON.stringify({ event: "payment_for_unknown_order", paymentIntentId: payment.paymentIntentId, status: payment.status }));
    return "unknown_order";
  }
  if (payment.currency !== "usd") return "amount_mismatch";

  const recorded = await tx.query(
    `insert into "audiophile_payments" ("payment_intent_id", "order_id", "checkout_session_id", "status", "amount_cents", "currency")
       values ($1, $2, $3, $4, $5, $6)
     on conflict ("payment_intent_id") do update set
       "status" = case when "audiophile_payments"."status" = 'succeeded' then 'succeeded' else excluded."status" end,
       "checkout_session_id" = coalesce("audiophile_payments"."checkout_session_id", excluded."checkout_session_id"),
       "updated_at" = now()
     where "audiophile_payments"."order_id" = excluded."order_id"`,
    [payment.paymentIntentId, payment.orderId, payment.checkoutSessionId, payment.status, payment.amountCents, payment.currency],
  );
  if (recorded.rowCount === 0) return "foreign_intent";
  if (payment.status !== "succeeded") return "recorded";
  if (payment.amountCents !== order.total_cents) return "amount_mismatch";
  if (order.status === "paid") {
    console.error(JSON.stringify({ event: "payment_after_settlement", orderId: payment.orderId }));
    return "already_paid";
  }
  if (order.status !== "pending_hosted") return "not_payable";
  await tx.query(
    `update "audiophile_orders" set "status" = 'paid', "settled_at" = now(), "updated_at" = now()
      where "id" = $1 and "status" = 'pending_hosted'`, [payment.orderId]);
  return "paid";
}

/** True the first time this webhook event is seen. */
export async function claimStripeEvent(tx: Transaction, eventId: string, type: string, orderId: string | null) {
  const { rowCount } = await tx.query(
    `insert into "audiophile_stripe_events" ("event_id", "type", "order_id") values ($1, $2, $3)
      on conflict ("event_id") do nothing`,
    [eventId, type, orderId],
  );
  return rowCount === 1;
}

/**
 * Unpaid orders older than seven days with their open card attempts. The
 * purge cancels those attempts at Stripe first, so none can succeed later.
 */
export async function abandonedOrderAttempts(db: Transaction) {
  const { rows } = await db.query<{ payment_intent_id: string }>(
    `select p."payment_intent_id" from "audiophile_orders" o
       join "audiophile_payments" p on p."order_id" = o."id"
      where o."status" in ('pending_hosted', 'pending_transfer', 'pending_in_person', 'cancelled')
        and o."created_at" < now() - interval '7 days'
        and p."status" in ('requires_payment_method', 'requires_confirmation', 'requires_action')`,
  );
  return rows.map((row) => row.payment_intent_id);
}

/** Recent hosted Checkout pages of unpaid orders older than seven days. */
export async function abandonedOrderSessions(db: Transaction) {
  const { rows } = await db.query<{ session_id: string }>(
    `select s."session_id" from "audiophile_orders" o
       join "audiophile_checkout_sessions" s on s."order_id" = o."id"
      where o."status" in ('pending_hosted', 'pending_transfer', 'pending_in_person', 'cancelled')
        and o."created_at" < now() - interval '7 days'
        and s."created_at" > now() - interval '25 hours'`,
  );
  return rows.map((row) => row.session_id);
}

/**
 * Removes orders never paid within seven days, with their items, attempts,
 * hosted pages and webhook receipts, plus rate-limit windows older than a
 * day. An order is kept while any of its payments could hold money (anything
 * but canceled or failed), so a charge that needs a refund is never lost.
 */
export async function purgeAbandonedOrders(pool: pg.Pool) {
  return inTransaction(pool, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `delete from "audiophile_orders" o
        where o."status" in ('pending_hosted', 'pending_transfer', 'pending_in_person', 'cancelled')
          and o."created_at" < now() - interval '7 days'
          and not exists (
            select 1 from "audiophile_payments" p
             where p."order_id" = o."id" and p."status" not in ('canceled', 'checkout_failed'))
        returning o."id"`,
    );
    const ids = rows.map((row) => row.id);
    await tx.query(`delete from "audiophile_stripe_events" where "order_id" = any($1::text[])`, [ids]);
    const limits = await tx.query(`delete from "audiophile_rate_limits" where "window_start" < now() - interval '1 day'`);
    return { purgedOrders: ids.length, purgedRateLimitWindows: limits.rowCount ?? 0 };
  });
}
