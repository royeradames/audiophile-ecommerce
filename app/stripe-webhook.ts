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
