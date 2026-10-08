import { createStripeCheckoutSession } from "../../../stripe-api";
import { stripePublicConfig } from "../../../stripe-env";
import { requestOrigin } from "../../../request-origin";
import { readPaymentRequest } from "../../../payment-request";
import { hostedCheckoutFor, payableOrder } from "../../../server/payments";
import { clientAddress, limits, overLimit, tooManyRequests } from "../../../server/rate-limit";
import { serverRuntime } from "../../../server/runtime";

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

  const runtimeForLimit = serverRuntime();
  if (runtimeForLimit) {
    try {
      const wait = await overLimit(runtimeForLimit.db, [
        { scope: "payments:address", id: clientAddress(request), limit: limits.paymentStartsPerAddress },
      ]);
      if (wait !== null) return tooManyRequests(wait, "Too many payment attempts from this connection.");
    } catch {
      return Response.json({ error: "Payment could not start. Nothing was charged; please try again." }, { status: 503 });
    }
  }

  const payment = await readPaymentRequest(request);
  if (!payment.ok) {
    return Response.json({ error: payment.error }, { status: payment.status });
  }

  const runtime = serverRuntime();
  if (runtime) {
    try {
      const payable = await payableOrder(runtime.db, payment, "hosted");
      if (!payable.ok) return Response.json({ error: payable.error }, { status: payable.status });
      const hosted = await hostedCheckoutFor(runtime.db, payable.order, {
        origin: requestOrigin(request),
        description: payment.description,
        email: payment.email,
      });
      if (!hosted.ok) return Response.json({ error: hosted.error }, { status: hosted.status });
      return Response.json({ url: hosted.url });
    } catch {
      return Response.json({ error: "Could not start Stripe test Checkout. Please try again." }, { status: 502 });
    }
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
