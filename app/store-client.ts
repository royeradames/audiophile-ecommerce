"use client";

import { z } from "zod";
import { orderSummarySchema, type NewOrder, type OrderSummary, type StoreFeatures } from "./order-api";

const featuresSchema = z.object({
  demo: z.boolean(),
  durableOrders: z.boolean(),
  accounts: z.enum(["enabled", "coming_soon"]),
});
let features: Promise<StoreFeatures> | null = null;

/**
 * What this deployment offers (the guest-only fallback answers too). A failed
 * check throws instead of guessing, so an order is never quietly kept in the
 * browser on a store that saves orders.
 */
export function fetchStoreFeatures() {
  features ??= fetch("/api/store/features", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("The store could not be reached.");
      return featuresSchema.parse(await response.json());
    })
    .catch((error: unknown) => {
      features = null;
      throw error;
    });
  return features;
}

const errorSchema = z.object({ error: z.string().min(1) });

async function errorFrom(response: Response, fallback: string) {
  return errorSchema.safeParse(await response.json().catch(() => null)).data?.error ?? fallback;
}

export async function createServerOrder(order: NewOrder) {
  const fallback = "Your order could not be saved. Nothing was charged; please try again.";
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(order),
    });
    if (!response.ok) return { ok: false as const, error: await errorFrom(response, fallback) };
    const body = z.object({ order: orderSummarySchema }).safeParse(await response.json());
    return body.success ? { ok: true as const, order: body.data.order as OrderSummary } : { ok: false as const, error: fallback };
  } catch {
    return { ok: false as const, error: fallback };
  }
}

export async function fetchServerOrder(orderId: string) {
  const fallback = "The order could not be loaded. Try again in a moment.";
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" });
    if (response.status === 404) return { ok: false as const, missing: true, error: await errorFrom(response, "No order has that ID.") };
    if (!response.ok) return { ok: false as const, missing: false, error: await errorFrom(response, fallback) };
    const body = z.object({ order: orderSummarySchema }).safeParse(await response.json());
    return body.success
      ? { ok: true as const, order: body.data.order as OrderSummary }
      : { ok: false as const, missing: false, error: fallback };
  } catch {
    return { ok: false as const, missing: false, error: fallback };
  }
}

export type AccountOrders =
  | { state: "signed_in"; customer: { name: string; email: string }; orders: OrderSummary[] }
  | { state: "signed_out" }
  | { state: "error"; error: string };

export async function fetchAccountOrders(): Promise<AccountOrders> {
  const fallback = "Your orders could not be loaded. Try again in a moment.";
  try {
    const response = await fetch("/api/account/orders", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) return { state: "signed_out" };
    if (!response.ok) return { state: "error", error: await errorFrom(response, fallback) };
    const body = z.object({
      customer: z.object({ name: z.string(), email: z.string() }),
      orders: z.array(orderSummarySchema),
    }).safeParse(await response.json());
    return body.success
      ? { state: "signed_in", customer: body.data.customer, orders: body.data.orders as OrderSummary[] }
      : { state: "error", error: fallback };
  } catch {
    return { state: "error", error: fallback };
  }
}

const principalSchema = z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable();

/** The customer signed in on this browser, or null. Throws when it cannot be checked. */
export async function fetchCustomer() {
  const response = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Your account could not be checked.");
  return principalSchema.parse(await response.json());
}

/** Same-origin path only; anything else returns to the account page. */
export function returnPath(value: string | null) {
  if (!value) return "/account";
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && !url.pathname.startsWith("//") && !url.pathname.includes("\\")
      ? `${url.pathname}${url.search}`
      : "/account";
  } catch {
    return "/account";
  }
}

/** Starts the Breakthrough account sign-in and returns the issuer address to open. */
export async function startSignIn(returnTo: string | null) {
  const response = await fetch("/api/auth/federation/start", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnPath: returnPath(returnTo) }),
  });
  const body = z.object({ url: z.url() }).safeParse(await response.json().catch(() => null));
  if (!response.ok || !body.success) throw new Error("Sign-in is temporarily unavailable. Please try again in a moment.");
  const destination = new URL(body.data.url);
  const loopback = ["localhost", "127.0.0.1"].includes(destination.hostname);
  if (destination.protocol !== "https:" && !loopback) throw new Error("Sign-in is temporarily unavailable.");
  return destination.href;
}

/** Ends this browser's Audiophile session. The Breakthrough account stays signed in. */
export async function signOutOfAudiophile() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Could not finish signing out. Please try again.");
}
