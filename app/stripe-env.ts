import { DEMO_STORE } from "./demo-store";

export type StripePublicConfig = {
  configured: boolean;
  blocked: "live" | null;
  publishableKey: string | null;
};

function read(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function stripeWebhookSecret() {
  const secret = read("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    return null;
  }
  if (!secret.startsWith("whsec_")) {
    return null;
  }
  return secret;
}

/**
 * Test-mode Stripe keys only. This is a demo store: a live key (or a
 * restricted live key) is refused, so it can never take a real card charge.
 */
export function stripePublicConfig(): StripePublicConfig {
  const secret = read("STRIPE_SECRET_KEY");
  const publishable = read("STRIPE_PUBLISHABLE_KEY");
  const live = /^(sk|rk)_live_/.test(secret) || publishable.startsWith("pk_live_");
  if (DEMO_STORE && live) {
    return { configured: false, blocked: "live", publishableKey: null };
  }
  if (!secret.startsWith("sk_test_") || !publishable.startsWith("pk_test_")) {
    return { configured: false, blocked: null, publishableKey: null };
  }
  return { configured: true, blocked: null, publishableKey: publishable };
}

export function stripeSecretKey() {
  const config = stripePublicConfig();
  if (!config.configured) {
    return null;
  }
  return read("STRIPE_SECRET_KEY");
}
