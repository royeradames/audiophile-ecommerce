import { createStripePaymentIntent, retrieveStripePaymentIntent } from "../../../stripe-api";
import { recordPaidOrder } from "../../../paid-ledger";
import { stripePublicConfig } from "../../../stripe-env";
import { readPaymentRequest } from "../../../payment-request";
import { paymentFromIntent } from "../../../stripe-webhook";
import { cardIntentFor, payableOrder, recordPayment, settledPaid } from "../../../server/payments";
import { serverRuntime } from "../../../server/runtime";

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
    let paid = status === "succeeded";
    const runtime = serverRuntime();
    const reported = paymentFromIntent(intent);
    if (runtime && reported) {
      // Retrieved from Stripe with the server key, so the status is trusted.
      paid = settledPaid(await recordPayment(runtime.db, reported));
    } else if (runtime) {
      paid = false;
    } else if (paid && orderId) {
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

  const payment = await readPaymentRequest(request);
  if (!payment.ok) {
    return Response.json({ error: payment.error }, { status: payment.status });
  }

  const runtime = serverRuntime();
  if (runtime) {
    try {
      const payable = await payableOrder(runtime.db, payment, "element");
      if (!payable.ok) return Response.json({ error: payable.error }, { status: payable.status });
      const intent = await cardIntentFor(runtime.db, payable.order);
      if (!intent.ok) return Response.json({ error: intent.error }, { status: intent.status });
      return Response.json({ clientSecret: intent.clientSecret, amount: payable.order.grandTotal });
    } catch {
      return Response.json({ error: "Could not start the Stripe test card form. Please try again." }, { status: 502 });
    }
  }

  try {
    const intent = await createStripePaymentIntent({
      orderId: payment.orderId,
      amountCents: payment.amountCents,
      email: payment.email,
    });
    const clientSecret = typeof intent.client_secret === "string" ? intent.client_secret : null;
    if (!clientSecret) {
      return Response.json({ error: "Stripe did not return a client secret." }, { status: 502 });
    }
    return Response.json({ clientSecret, amount: payment.amount });
  } catch {
    return Response.json({ error: "Could not start the Stripe test card form. Please try again." }, { status: 502 });
  }
}
