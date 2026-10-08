import { recordPaidOrder } from "../../../paid-ledger";
import { stripeWebhookSecret } from "../../../stripe-env";
import {
  orderIdFromStripeEvent,
  paymentFromStripeEvent,
  verifyStripeWebhookSignature,
} from "../../../stripe-webhook";
import { claimStripeEvent, inTransaction, settleStripePayment } from "../../../server/order-store";
import { serverRuntime } from "../../../server/runtime";

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

  const runtime = serverRuntime();
  if (!runtime) {
    // Guest-only fallback: no database, so the paid record lives in memory.
    const orderId = orderIdFromStripeEvent(event);
    if (orderId) {
      recordPaidOrder(orderId, "webhook");
    }
    return Response.json({ received: true, orderId });
  }

  const record = event as { id?: unknown; type?: unknown; livemode?: unknown };
  const eventId = typeof record.id === "string" && /^evt_[A-Za-z0-9_]+$/.test(record.id) ? record.id : null;
  const type = typeof record.type === "string" ? record.type.slice(0, 100) : "";
  if (!eventId || record.livemode === true) {
    return Response.json({ received: true, ignored: true });
  }
  const payment = paymentFromStripeEvent(event);
  try {
    const outcome = await inTransaction(runtime.db, async (tx) => {
      // The claim commits with the status change, so a failed delivery is retried.
      if (!await claimStripeEvent(tx, eventId, type, payment?.orderId ?? null)) return "duplicate";
      return payment ? settleStripePayment(tx, payment) : "ignored";
    });
    return Response.json({ received: true, orderId: payment?.orderId ?? null, outcome });
  } catch {
    console.error(JSON.stringify({ event: "stripe_webhook_failed", type }));
    return Response.json({ error: "The event could not be recorded. Stripe will retry it." }, { status: 500 });
  }
}
