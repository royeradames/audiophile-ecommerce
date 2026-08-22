import { createStripePaymentIntent, retrieveStripePaymentIntent } from "../../../stripe-api";
import { recordPaidOrder } from "../../../paid-ledger";
import { stripePublicConfig } from "../../../stripe-env";
import { usdToCents } from "../../../checkout-totals";

export async function GET(request: Request) {
  const config = stripePublicConfig();
  if (config.blocked === "live") {
    return Response.json({ error: "Live Stripe keys are blocked. Use sk_test_ / pk_test_ only." }, { status: 400 });
  }
  if (!config.configured) {
    return Response.json({ error: "Stripe test keys are missing." }, { status: 503 });
  }

  const intentId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!intentId.startsWith("pi_")) {
    return Response.json({ error: "A PaymentIntent id is required." }, { status: 400 });
  }

  try {
    const intent = await retrieveStripePaymentIntent(intentId);
    if (intent.livemode === true) {
      return Response.json({ error: "Live Stripe objects are blocked." }, { status: 400 });
    }
    const status = typeof intent.status === "string" ? intent.status : "";
    const metadata = intent.metadata && typeof intent.metadata === "object" ? intent.metadata : null;
    const orderId =
      metadata && "order_id" in metadata && typeof metadata.order_id === "string"
        ? metadata.order_id
        : null;
    const paid = status === "succeeded";
    if (paid && orderId) {
      recordPaidOrder(orderId, "payment_intent");
    }
    return Response.json({
      id: intent.id,
      status,
      orderId,
      paid,
      livemode: intent.livemode === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve the PaymentIntent.";
    return Response.json({ error: message }, { status: 502 });
  }
}

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
  };
  const orderId = payload.orderId?.trim() ?? "";
  const email = payload.email?.trim() ?? "";
  const amount = payload.amount;

  if (!orderId.startsWith("AUD-") || !email || typeof amount !== "number" || amount <= 0) {
    return Response.json({ error: "orderId, email, and amount are required." }, { status: 400 });
  }

  try {
    const intent = await createStripePaymentIntent({
      orderId,
      amountCents: usdToCents(amount),
      email,
    });
    const clientSecret = typeof intent.client_secret === "string" ? intent.client_secret : null;
    if (!clientSecret) {
      return Response.json({ error: "Stripe did not return a client secret." }, { status: 502 });
    }
    return Response.json({ clientSecret });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe PaymentIntent failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
