import { createStripeCheckoutSession } from "../../../stripe-api";
import { stripePublicConfig } from "../../../stripe-env";
import { requestOrigin } from "../../../request-origin";
import { usdToCents } from "../../../checkout-totals";

export async function POST(request: Request) {
  const config = stripePublicConfig();
  if (config.blocked === "live") {
    return Response.json({ error: "Live Stripe keys are blocked. Use sk_test_ / pk_test_ only." }, { status: 400 });
  }
  if (!config.configured) {
    return Response.json(
      { error: "Stripe test keys are missing. Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY." },
      { status: 503 },
    );
  }

  const payload = (await request.json()) as {
    orderId?: string;
    amount?: number;
    email?: string;
    description?: string;
  };
  const orderId = payload.orderId?.trim() ?? "";
  const email = payload.email?.trim() ?? "";
  const description = payload.description?.trim() || `Audiophile ${orderId}`;
  const amount = payload.amount;

  if (!orderId.startsWith("AUD-") || !email || typeof amount !== "number" || amount <= 0) {
    return Response.json({ error: "orderId, email, and amount are required." }, { status: 400 });
  }

  try {
    const session = await createStripeCheckoutSession({
      orderId,
      amountCents: usdToCents(amount),
      email,
      origin: requestOrigin(request),
      description,
    });
    const url = typeof session.url === "string" ? session.url : null;
    if (!url) {
      return Response.json({ error: "Stripe did not return a Checkout URL." }, { status: 502 });
    }
    return Response.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe Checkout failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
