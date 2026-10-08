import type { BrowserContext } from "@playwright/test";

// Supplied by the runner's private environment. Values never reach test
// output: they are attached only through per-origin request routing.
function origin(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error("Set " + name + " for the hosted suite");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(name + " must be HTTPS");
  return url.origin;
}

export const shopOrigin = origin("AUDIOPHILE_PREVIEW_URL");
export const accountsOrigin = origin("ACCOUNTS_PREVIEW_URL", "https://accounts-preview.royeradames.com");
const bypass = new Map([
  [shopOrigin, process.env.AUDIOPHILE_PREVIEW_BYPASS ?? ""],
  [accountsOrigin, process.env.ACCOUNTS_PREVIEW_BYPASS ?? ""],
]);
if (!bypass.get(shopOrigin)) throw new Error("Set AUDIOPHILE_PREVIEW_BYPASS for the hosted suite");

/** True when the issuer secrets exist, so the account journey can run. */
export const accountsConfigured = Boolean(bypass.get(accountsOrigin) && process.env.AUTH_PREVIEW_SINK_TOKEN);

/** Adds each project's protection bypass only to requests for its own origin. */
export async function authorizePreviews(context: BrowserContext) {
  await context.route(
    (url) => Boolean(bypass.get(url.origin)),
    async (route) => {
      const secret = bypass.get(new URL(route.request().url()).origin) ?? "";
      await route.continue({
        headers: { ...route.request().headers(), "x-vercel-protection-bypass": secret, "x-vercel-set-bypass-cookie": "true" },
      });
    },
  );
}

/** Reads the issuer's synthetic preview mailbox. Failures never echo secrets. */
export async function readSink(address: string) {
  const url = new URL("/api/preview-mail?to=" + encodeURIComponent(address), accountsOrigin);
  try {
    return await fetch(url, {
      headers: {
        "x-vercel-protection-bypass": bypass.get(accountsOrigin) ?? "",
        authorization: "Bearer " + (process.env.AUTH_PREVIEW_SINK_TOKEN ?? ""),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Preview mailbox request failed");
  }
}

/**
 * Pays a test-mode PaymentIntent with Stripe's test card token, as the card
 * form would. Test keys only; nothing is typed into a card field.
 */
export async function payWithTestCard(paymentIntentId: string) {
  const key = process.env.STRIPE_TEST_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("STRIPE_TEST_SECRET_KEY must be a Stripe test key");
  const body = new URLSearchParams({ payment_method: "pm_card_visa", return_url: shopOrigin + "/checkout/stripe" });
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/confirm`, {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!response) throw new Error("Stripe test confirmation failed");
  const intent = (await response.json()) as { status?: string; livemode?: boolean };
  if (intent.livemode !== false || intent.status !== "succeeded") throw new Error("Stripe test confirmation did not succeed");
}
