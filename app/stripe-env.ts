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
 * Test-mode Stripe keys only. Live keys are refused so this shop cannot take
 * a real card charge until a later live-merchant decision.
 */
export function stripePublicConfig(): StripePublicConfig {
  const secret = read("STRIPE_SECRET_KEY");
  const publishable = read("STRIPE_PUBLISHABLE_KEY");
  if (secret.startsWith("sk_live_") || publishable.startsWith("pk_live_")) {
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
