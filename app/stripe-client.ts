import type { StripePublicConfig } from "./stripe-env";

export async function fetchStripeConfig(): Promise<StripePublicConfig> {
  const response = await fetch("/api/stripe/config");
  if (!response.ok) {
    return { configured: false, blocked: null, publishableKey: null };
  }
  return (await response.json()) as StripePublicConfig;
}

export async function startHostedCheckout(input: {
  orderId: string;
  amount: number;
  email: string;
  description: string;
}) {
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !body.url) {
    return { ok: false as const, error: body.error || "Could not start Stripe Checkout." };
  }
  return { ok: true as const, url: body.url };
}

export async function createPaymentIntent(input: {
  orderId: string;
  amount: number;
  email: string;
}) {
  const response = await fetch("/api/stripe/payment-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { clientSecret?: string; error?: string };
  if (!response.ok || !body.clientSecret) {
    return { ok: false as const, error: body.error || "Could not start the card form." };
  }
  return { ok: true as const, clientSecret: body.clientSecret };
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
    return [] as string[];
  }
  const body = (await response.json()) as { orders?: Array<{ orderId?: string }> };
  return (body.orders ?? [])
    .map((entry) => entry.orderId)
    .filter((orderId): orderId is string => typeof orderId === "string");
}
