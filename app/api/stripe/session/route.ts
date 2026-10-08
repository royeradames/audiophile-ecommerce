import { retrieveStripeCheckoutSession } from "../../../stripe-api";
import { recordPaidOrder } from "../../../paid-ledger";
import { stripePublicConfig } from "../../../stripe-env";
import { paymentFromCheckoutSession } from "../../../stripe-webhook";
import { recordPayment, settledPaid } from "../../../server/payments";
import { serverRuntime } from "../../../server/runtime";

export async function GET(request: Request) {
  const config = stripePublicConfig();
  if (!config.configured) {
    return Response.json({ error: "Stripe test keys are missing." }, { status: 503 });
  }

  const sessionId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!sessionId.startsWith("cs_test_")) {
    return Response.json({ error: "A test Checkout session id is required." }, { status: 400 });
  }

  try {
    const session = await retrieveStripeCheckoutSession(sessionId);
    if (session.livemode === true) {
      return Response.json({ error: "Live Stripe objects are blocked." }, { status: 400 });
    }
    const paymentStatus = typeof session.payment_status === "string" ? session.payment_status : "";
    const orderId =
      typeof session.client_reference_id === "string" ? session.client_reference_id : null;
    let paid = paymentStatus === "paid";
    const runtime = serverRuntime();
    const reported = paymentFromCheckoutSession(session);
    if (runtime && reported) {
      // Retrieved from Stripe with the server key, so the status is trusted.
      paid = settledPaid(await recordPayment(runtime.db, reported));
    } else if (runtime) {
      paid = false;
    } else if (paid && orderId) {
      recordPaidOrder(orderId, "checkout.session");
    }
    return Response.json({
      id: session.id,
      paymentStatus,
      orderId,
      paid,
      livemode: session.livemode === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve the Stripe session.";
    return Response.json({ error: message }, { status: 502 });
  }
}
