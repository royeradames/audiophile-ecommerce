import type pg from "pg";
import type { PaymentRequest } from "../payment-request";
import { createStripePaymentIntent, retrieveStripePaymentIntent } from "../stripe-api";
import type { ReportedPayment } from "../stripe-webhook";
import {
  countAttempts,
  getOrder,
  inTransaction,
  latestReusableAttempt,
  settleStripePayment,
  type SettleOutcome,
  type StoredOrder,
} from "./order-store";

type Refusal = { ok: false; status: number; error: string };

const statusCopy: Record<StoredOrder["status"], string> = {
  pending_hosted: "is waiting for card payment",
  pending_transfer: "is waiting for a bank transfer",
  pending_in_person: "is paid in person",
  paid: "is already paid",
  in_person_collected: "is already collected",
  cancelled: "was cancelled",
};

/**
 * The stored order a card payment may start for. The browser names the order
 * and repeats its cart; the server charges the stored total.
 */
export async function payableOrder(db: pg.Pool, request: PaymentRequest): Promise<{ ok: true; order: StoredOrder } | Refusal> {
  const order = await getOrder(db, request.orderId);
  if (!order) return { ok: false, status: 404, error: "No order has that ID. Place the order again from checkout." };
  const sameItems = request.items.length === order.lines.length &&
    request.items.every((item) => order.lines.some((line) => line.productId === item.productId && line.quantity === item.quantity));
  if (order.email.toLowerCase() !== request.email.toLowerCase() || !sameItems) {
    return { ok: false, status: 409, error: "These details do not match the saved order. Reload the order and try again." };
  }
  if (order.status !== "pending_hosted") {
    return { ok: false, status: 409, error: `Order ${order.id} ${statusCopy[order.status]}. Nothing was charged.` };
  }
  return { ok: true, order };
}

const reusableStatuses = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

/**
 * Returns a card form for the order. A retry reuses the unfinished
 * PaymentIntent, so cancelling and retrying never creates a second order or a
 * second open charge.
 */
export async function cardIntentFor(db: pg.Pool, order: StoredOrder) {
  const reusable = await latestReusableAttempt(db, order.id);
  if (reusable && reusable.amount_cents === order.totalCents) {
    const intent = await retrieveStripePaymentIntent(reusable.payment_intent_id);
    if (intent.livemode !== true && reusableStatuses.has(String(intent.status)) &&
        intent.amount === order.totalCents && typeof intent.client_secret === "string") {
      return intent.client_secret;
    }
  }
  const attempt = await countAttempts(db, order.id);
  const intent = await createStripePaymentIntent({
    orderId: order.id,
    amountCents: order.totalCents,
    email: order.email,
    idempotencyKey: `audiophile:${order.id}:intent:${attempt}`,
  });
  if (typeof intent.id !== "string" || typeof intent.client_secret !== "string" || intent.livemode === true) {
    throw new Error("Stripe did not return a test PaymentIntent.");
  }
  await recordPayment(db, {
    orderId: order.id,
    paymentIntentId: intent.id,
    checkoutSessionId: null,
    status: String(intent.status),
    amountCents: order.totalCents,
    currency: "usd",
    livemode: false,
  });
  return intent.client_secret;
}

export function recordPayment(db: pg.Pool, payment: ReportedPayment): Promise<SettleOutcome> {
  return inTransaction(db, (tx) => settleStripePayment(tx, payment));
}

export function settledPaid(outcome: SettleOutcome) {
  return outcome === "paid" || outcome === "already_paid";
}
