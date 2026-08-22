import { recordPaidOrder } from "../../../paid-ledger";
import { stripeWebhookSecret } from "../../../stripe-env";
import { orderIdFromStripeEvent, verifyStripeWebhookSignature } from "../../../stripe-webhook";

export async function POST(request: Request) {
  const secret = stripeWebhookSecret();
  if (!secret) {
    return Response.json({ error: "STRIPE_WEBHOOK_SECRET is not set." }, { status: 503 });
  }

  const payload = await request.text();
  const header = request.headers.get("stripe-signature") ?? "";
  const verified = await verifyStripeWebhookSignature(payload, header, secret);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const orderId = orderIdFromStripeEvent(event);
  if (orderId) {
    recordPaidOrder(orderId, "webhook");
  }

  return Response.json({ received: true, orderId });
}
