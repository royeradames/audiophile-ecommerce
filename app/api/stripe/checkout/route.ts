import { createStripeCheckoutSession } from "../../../stripe-api";
import { stripePublicConfig } from "../../../stripe-env";
import { requestOrigin } from "../../../request-origin";
import { readPaymentRequest } from "../../../payment-request";

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

  const payment = await readPaymentRequest(request);
  if (!payment.ok) {
    return Response.json({ error: payment.error }, { status: payment.status });
  }

  try {
    const session = await createStripeCheckoutSession({
      orderId: payment.orderId,
      amountCents: payment.amountCents,
      email: payment.email,
      origin: requestOrigin(request),
      description: payment.description,
    });
    const url = typeof session.url === "string" ? session.url : null;
    if (!url) {
      return Response.json({ error: "Stripe did not return a Checkout URL." }, { status: 502 });
    }
    return Response.json({ url });
  } catch {
    return Response.json({ error: "Could not start Stripe test Checkout. Please try again." }, { status: 502 });
  }
}
