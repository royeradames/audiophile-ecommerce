import * as z from "zod/mini";
import type { PaymentRequest } from "./payment-request";
import type { StripePublicConfig } from "./stripe-env";

export async function fetchStripeConfig(): Promise<StripePublicConfig> {
  const response = await fetch("/api/stripe/config");
  if (!response.ok) {
    return { configured: false, blocked: null, publishableKey: null };
  }
  return (await response.json()) as StripePublicConfig;
}

function paymentBody(input: PaymentRequest) {
  return JSON.stringify({
    orderId: input.orderId,
    // The email stays in the browser: the demo store never sends it.
    items: input.items.map(({ productId, quantity }) => ({ productId, quantity })),
  });
}

const paymentErrorSchema = z.object({ error: z.string().check(z.minLength(1)) });
const checkoutResponseSchema = z.object({ url: z.url() });
const intentResponseSchema = z.object({ clientSecret: z.string().check(z.minLength(1)), amount: z.number().check(z.positive()) });

export async function startHostedCheckout(input: PaymentRequest) {
  const fallback = "Could not start Stripe test Checkout. Please try again.";
  try {
    const response = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: paymentBody(input),
    });
    const body: unknown = await response.json();
    const parsed = checkoutResponseSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      return { ok: false as const, error: paymentErrorSchema.safeParse(body).data?.error ?? fallback };
    }
    return { ok: true as const, url: parsed.data.url };
  } catch {
    return { ok: false as const, error: fallback };
  }
}

export async function createPaymentIntent(input: PaymentRequest) {
  const fallback = "Could not start the Stripe test card form. Please try again.";
  try {
    const response = await fetch("/api/stripe/payment-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: paymentBody(input),
    });
    const body: unknown = await response.json();
    const parsed = intentResponseSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      return { ok: false as const, error: paymentErrorSchema.safeParse(body).data?.error ?? fallback };
    }
    return { ok: true as const, ...parsed.data };
  } catch {
    return { ok: false as const, error: fallback };
  }
}

export async function fetchStripeSession(sessionId: string) {
  const response = await fetch(`/api/stripe/session?id=${encodeURIComponent(sessionId)}`);
  const body = (await response.json()) as {
    paid?: boolean;
    orderId?: string | null;
    paymentStatus?: string;
    error?: string;
  };
  if (!response.ok) {
    return { ok: false as const, error: body.error || "Could not read the Stripe session." };
  }
  return {
    ok: true as const,
    paid: body.paid === true,
    orderId: body.orderId ?? null,
    paymentStatus: body.paymentStatus ?? "",
  };
}

export async function fetchStripePaymentIntent(intentId: string) {
  const response = await fetch(`/api/stripe/payment-intent?id=${encodeURIComponent(intentId)}`);
  const body = (await response.json()) as {
    paid?: boolean;
    orderId?: string | null;
    status?: string;
    error?: string;
  };
  if (!response.ok) {
    return { ok: false as const, error: body.error || "Could not read the Stripe payment." };
  }
  return {
    ok: true as const,
    paid: body.paid === true,
    orderId: body.orderId ?? null,
    paymentStatus: body.status ?? "",
  };
}

export async function fetchPaidOrderIds() {
  const response = await fetch("/api/stripe/paid");
  if (!response.ok) {
    return { paid: [] as string[], refundsNeeded: [] as Array<{ orderId: string; payments: number }> };
  }
  const body = (await response.json()) as {
    orders?: Array<{ orderId?: string }>;
    refundsNeeded?: Array<{ orderId?: string; payments?: number }>;
  };
  return {
    paid: (body.orders ?? [])
      .map((entry) => entry.orderId)
      .filter((orderId): orderId is string => typeof orderId === "string"),
    refundsNeeded: (body.refundsNeeded ?? []).flatMap((entry) =>
      typeof entry.orderId === "string" && typeof entry.payments === "number"
        ? [{ orderId: entry.orderId, payments: entry.payments }]
        : []),
  };
}
