import { stripeSecretKey } from "./stripe-env";

type StripeObject = Record<string, unknown>;

async function stripeRequest(path: string, init: RequestInit) {
  const secret = stripeSecretKey();
  if (!secret) {
    throw new Error("Stripe test keys are not configured.");
  }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json()) as StripeObject;
  if (!response.ok) {
    const message =
      typeof body.error === "object" &&
      body.error &&
      "message" in body.error &&
      typeof (body.error as { message: unknown }).message === "string"
        ? (body.error as { message: string }).message
        : "Stripe request failed.";
    throw new Error(message);
  }
  return body;
}

export async function createStripeCheckoutSession(input: {
  orderId: string;
  amountCents: number;
  email: string;
  origin: string;
  description: string;
  /** Stripe returns the same session for a repeated key instead of creating another. */
  idempotencyKey?: string;
}) {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("client_reference_id", input.orderId);
  params.set("customer_email", input.email);
  params.set("success_url", `${input.origin}/checkout/stripe?order=${encodeURIComponent(input.orderId)}&session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${input.origin}/checkout?canceled=1&order=${encodeURIComponent(input.orderId)}`);
  params.set("metadata[order_id]", input.orderId);
  params.set("payment_intent_data[metadata][order_id]", input.orderId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
  params.set("line_items[0][price_data][product_data][name]", `Audiophile ${input.orderId}`);
  params.set("line_items[0][price_data][product_data][description]", input.description);
  params.set("payment_method_types[0]", "card");

  return stripeRequest("checkout/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
    },
    body: params,
  });
}

export async function retrieveStripeCheckoutSession(sessionId: string) {
  return stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
  });
}

export async function retrieveStripePaymentIntent(intentId: string) {
  return stripeRequest(`payment_intents/${encodeURIComponent(intentId)}`, {
    method: "GET",
  });
}

export async function createStripePaymentIntent(input: {
  orderId: string;
  amountCents: number;
  email: string;
  /** Stripe returns the same intent for a repeated key instead of creating another. */
  idempotencyKey?: string;
}) {
  const params = new URLSearchParams();
  params.set("amount", String(input.amountCents));
  params.set("currency", "usd");
  params.set("receipt_email", input.email);
  params.set("metadata[order_id]", input.orderId);
  params.set("automatic_payment_methods[enabled]", "true");
  params.set("description", `Audiophile ${input.orderId}`);

  return stripeRequest("payment_intents", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
    },
    body: params,
  });
}

/** Closes an open hosted Checkout page so it can no longer take payment. */
export async function expireStripeCheckoutSession(sessionId: string) {
  return stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}/expire`, { method: "POST" });
}
