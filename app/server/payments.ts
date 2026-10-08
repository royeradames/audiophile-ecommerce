import type pg from "pg";
import type { PaymentMethod } from "../payment-methods";
import type { PaymentRequest } from "../payment-request";
import {
  createStripeCheckoutSession,
  createStripePaymentIntent,
  expireStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  retrieveStripePaymentIntent,
} from "../stripe-api";
import { intentStatus, paymentFromCheckoutSession, paymentFromIntent, type ReportedPayment } from "../stripe-webhook";
import {
  checkoutSessionsFor,
  countAttempts,
  getOrder,
  inTransaction,
  openAttempts,
  recordCheckoutSession,
  settleStripePayment,
  type SettleOutcome,
  type StoredOrder,
} from "./order-store";

export type Refusal = { ok: false; status: number; error: string };

const statusCopy: Record<StoredOrder["status"], string> = {
  pending_hosted: "is waiting for card payment",
  pending_transfer: "is waiting for a bank transfer",
  pending_in_person: "is paid in person",
  paid: "is already paid",
  in_person_collected: "is already collected",
  cancelled: "was cancelled",
};

function alreadyPaid(order: StoredOrder): Refusal {
  return { ok: false, status: 409, error: `Order ${order.id} is already paid. Nothing more was charged.` };
}

/**
 * The stored order a card payment may start for. The browser names the order
 * and repeats its cart; the server charges the stored total, and only through
 * the payment method chosen at checkout.
 */
export async function payableOrder(
  db: pg.Pool,
  request: PaymentRequest,
  method: Extract<PaymentMethod, "hosted" | "element">,
): Promise<{ ok: true; order: StoredOrder } | Refusal> {
  const order = await getOrder(db, request.orderId);
  if (!order) return { ok: false, status: 404, error: "No order has that ID. Place the order again from checkout." };
  const sameItems = request.items.length === order.lines.length &&
    request.items.every((item) => order.lines.some((line) => line.productId === item.productId && line.quantity === item.quantity));
  if (!sameItems) {
    return { ok: false, status: 409, error: "These details do not match the saved order. Reload the order and try again." };
  }
  if (order.status !== "pending_hosted") {
    return { ok: false, status: 409, error: `Order ${order.id} ${statusCopy[order.status]}. Nothing was charged.` };
  }
  if (order.payment !== method) {
    return { ok: false, status: 409, error: `Order ${order.id} is paid with the method chosen at checkout. Open its order page to pay.` };
  }
  return { ok: true, order };
}

export function recordPayment(db: pg.Pool, payment: ReportedPayment): Promise<SettleOutcome> {
  return inTransaction(db, (tx) => settleStripePayment(tx, payment));
}

export function settledPaid(outcome: SettleOutcome) {
  return outcome === "paid" || outcome === "already_paid";
}

const reusableStatuses = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

/**
 * Returns a card form for the order. Earlier attempts are checked with Stripe
 * first: one that already succeeded settles the order instead of opening a
 * second charge, one still processing blocks a new charge, and an unfinished
 * one is reused, so cancelling and retrying keeps one order and one charge.
 */
export async function cardIntentFor(db: pg.Pool, order: StoredOrder, email?: string): Promise<{ ok: true; clientSecret: string } | Refusal> {
  let reusable: string | null = null;
  for (const attempt of await openAttempts(db, order.id)) {
    const intent = await retrieveStripePaymentIntent(attempt.payment_intent_id);
    const reported = paymentFromIntent(intent);
    if (reported && reported.orderId === order.id) await recordPayment(db, reported);
    const status = intentStatus(intent.status);
    if (status === "succeeded") return alreadyPaid(order);
    if (status === "processing") {
      return { ok: false, status: 409, error: `A payment for order ${order.id} is still processing. Check the order page in a moment.` };
    }
    if (!reusable && intent.livemode !== true && status && reusableStatuses.has(status) &&
        intent.amount === order.totalCents && typeof intent.client_secret === "string") {
      reusable = intent.client_secret;
    }
  }
  if (reusable) return { ok: true, clientSecret: reusable };

  const attempt = await countAttempts(db, order.id);
  const intent = await createStripePaymentIntent({
    orderId: order.id,
    amountCents: order.totalCents,
    email,
    idempotencyKey: `audiophile:${order.id}:intent:${attempt}`,
  });
  if (typeof intent.id !== "string" || typeof intent.client_secret !== "string" || intent.livemode === true) {
    throw new Error("Stripe did not return a test PaymentIntent.");
  }
  await recordPayment(db, {
    orderId: order.id,
    paymentIntentId: intent.id,
    checkoutSessionId: null,
    status: intentStatus(intent.status) ?? "unknown",
    amountCents: order.totalCents,
    currency: "usd",
    livemode: false,
  });
  return { ok: true, clientSecret: intent.client_secret };
}

/**
 * Opens one hosted Checkout page for the order. Earlier pages are checked
 * first: a paid one settles the order, and open ones are expired so the old
 * page (for example, reached with Back) can no longer take a second payment.
 */
export async function hostedCheckoutFor(
  db: pg.Pool,
  order: StoredOrder,
  input: { origin: string; description: string; email?: string },
): Promise<{ ok: true; url: string } | Refusal> {
  const earlier = await checkoutSessionsFor(db, order.id);
  for (const sessionId of earlier) {
    const session = await retrieveStripeCheckoutSession(sessionId);
    const reported = paymentFromCheckoutSession(session);
    if (reported && reported.orderId === order.id) await recordPayment(db, reported);
    if (session.payment_status === "paid") return alreadyPaid(order);
    if (session.status === "complete") {
      return { ok: false, status: 409, error: `A payment for order ${order.id} is still processing. Check the order page in a moment.` };
    }
    if (session.status === "open") await expireStripeCheckoutSession(sessionId);
  }
  const session = await createStripeCheckoutSession({
    orderId: order.id,
    amountCents: order.totalCents,
    email: input.email,
    origin: input.origin,
    description: input.description,
    // Simultaneous requests (two tabs, a double click) get the same page.
    idempotencyKey: `audiophile:${order.id}:session:${earlier.length}`,
  });
  if (typeof session.id !== "string" || typeof session.url !== "string" || session.livemode === true) {
    throw new Error("Stripe did not return a test Checkout session.");
  }
  await recordCheckoutSession(db, order.id, session.id);
  return { ok: true, url: session.url };
}
