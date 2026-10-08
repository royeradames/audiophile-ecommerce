const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export type StripeWebhookCheck =
  | { ok: true; timestamp: number }
  | { ok: false; error: string };

function timingEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies a Stripe-Signature header against the raw webhook body. Test-mode
 * endpoint secrets only. Rejects stale timestamps.
 */
export async function verifyStripeWebhookSignature(
  payload: string,
  header: string,
  secret: string,
  now = Date.now(),
): Promise<StripeWebhookCheck> {
  if (!payload || !header || !secret) {
    return { ok: false, error: "Missing webhook payload, signature, or secret." };
  }
  if (!secret.startsWith("whsec_")) {
    return { ok: false, error: "STRIPE_WEBHOOK_SECRET must start with whsec_." };
  }

  const parts = Object.fromEntries(
    header.split(",").map((piece) => {
      const [key, ...rest] = piece.split("=");
      return [key.trim(), rest.join("=")];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) {
    return { ok: false, error: "Malformed Stripe-Signature header." };
  }
  if (Math.abs(now - timestamp * 1000) > SIGNATURE_TOLERANCE_MS) {
    return { ok: false, error: "Stripe webhook timestamp is too old." };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  if (!timingEqual(expected, signature)) {
    return { ok: false, error: "Stripe webhook signature mismatch." };
  }
  return { ok: true, timestamp };
}

const PAID_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.succeeded",
]);

export function orderIdFromStripeEvent(event: unknown) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const record = event as {
    type?: unknown;
    data?: { object?: Record<string, unknown> };
  };
  const object = record.data?.object;
  if (!object) {
    return null;
  }

  const type = typeof record.type === "string" ? record.type : "";
  if (!PAID_EVENT_TYPES.has(type)) {
    return null;
  }

  if (type.startsWith("checkout.session.")) {
    const paymentStatus = object.payment_status;
    if (typeof paymentStatus === "string" && paymentStatus !== "paid") {
      return null;
    }
    const reference = object.client_reference_id;
    if (typeof reference === "string" && reference.startsWith("AUD-")) {
      return reference;
    }
  }

  const metadata = object.metadata;
  if (metadata && typeof metadata === "object") {
    const orderId = (metadata as { order_id?: unknown }).order_id;
    if (typeof orderId === "string" && orderId.startsWith("AUD-")) {
      return orderId;
    }
  }

  return null;
}

type StripeRecord = Record<string, unknown>;

export type ReportedPayment = {
  orderId: string;
  paymentIntentId: string;
  checkoutSessionId: string | null;
  status: string;
  amountCents: number;
  currency: string;
  livemode: boolean;
};

function text(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function metadataOrderId(object: StripeRecord) {
  const metadata = object.metadata;
  return metadata && typeof metadata === "object" ? text((metadata as StripeRecord).order_id) : null;
}

/** A PaymentIntent, as an event payload or a server-side retrieval. */
export function paymentFromIntent(object: StripeRecord): ReportedPayment | null {
  const orderId = metadataOrderId(object);
  const paymentIntentId = text(object.id);
  const status = text(object.status);
  const succeeded = status === "succeeded";
  const amount = succeeded ? object.amount_received : object.amount;
  if (!orderId?.startsWith("AUD-") || !paymentIntentId?.startsWith("pi_") || !status ||
      typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  return {
    orderId,
    paymentIntentId,
    checkoutSessionId: null,
    status,
    amountCents: amount,
    currency: text(object.currency) ?? "",
    livemode: object.livemode === true,
  };
}

/** A completed Checkout session reports its PaymentIntent once it is paid. */
export function paymentFromCheckoutSession(object: StripeRecord): ReportedPayment | null {
  const orderId = text(object.client_reference_id) ?? metadataOrderId(object);
  const sessionId = text(object.id);
  const intent = object.payment_intent;
  const paymentIntentId = typeof intent === "string" ? intent : text((intent as StripeRecord | null)?.id);
  const amount = object.amount_total;
  if (!orderId?.startsWith("AUD-") || !sessionId?.startsWith("cs_") || !paymentIntentId?.startsWith("pi_") ||
      typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  const paymentStatus = text(object.payment_status);
  return {
    orderId,
    paymentIntentId,
    checkoutSessionId: sessionId,
    status: paymentStatus === "paid" ? "succeeded" : `checkout_${paymentStatus ?? "unknown"}`,
    amountCents: amount,
    currency: text(object.currency) ?? "",
    livemode: object.livemode === true,
  };
}

const INTENT_EVENTS = new Set([
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

const SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
]);

/** The payment a verified webhook event reports, or null for other events. */
export function paymentFromStripeEvent(event: unknown): ReportedPayment | null {
  if (!event || typeof event !== "object") return null;
  const record = event as { type?: unknown; data?: { object?: StripeRecord } };
  const object = record.data?.object;
  const type = typeof record.type === "string" ? record.type : "";
  if (!object) return null;
  if (INTENT_EVENTS.has(type)) return paymentFromIntent(object);
  if (SESSION_EVENTS.has(type)) {
    const payment = paymentFromCheckoutSession(object);
    if (payment && type === "checkout.session.async_payment_failed") payment.status = "checkout_failed";
    return payment;
  }
  return null;
}
