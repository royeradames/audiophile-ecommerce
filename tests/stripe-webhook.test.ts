import assert from "node:assert/strict";
import test from "node:test";
import {
  orderIdFromStripeEvent,
  verifyStripeWebhookSignature,
} from "../app/stripe-webhook.ts";

const secret = "whsec_test_audiophile";
const payload = JSON.stringify({
  type: "checkout.session.completed",
  data: { object: { client_reference_id: "AUD-TEST" } },
});

async function sign(body: string, timestamp: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

test("accepts a fresh Stripe webhook signature and rejects a bad one", async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const header = await sign(payload, timestamp);
  const ok = await verifyStripeWebhookSignature(payload, header, secret);
  assert.equal(ok.ok, true);

  const bad = await verifyStripeWebhookSignature(payload, header, "whsec_other");
  assert.equal(bad.ok, false);
});

test("reads AUD- order ids from Checkout and PaymentIntent events", () => {
  assert.equal(
    orderIdFromStripeEvent({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "AUD-ABCD" } },
    }),
    "AUD-ABCD",
  );
  assert.equal(
    orderIdFromStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: { metadata: { order_id: "AUD-ELEM" } } },
    }),
    "AUD-ELEM",
  );
  assert.equal(orderIdFromStripeEvent({ type: "ping" }), null);
  assert.equal(
    orderIdFromStripeEvent({
      type: "payment_intent.created",
      data: { object: { metadata: { order_id: "AUD-ELEM" } } },
    }),
    null,
  );
  assert.equal(
    orderIdFromStripeEvent({
      type: "checkout.session.expired",
      data: {
        object: {
          client_reference_id: "AUD-ABCD",
          metadata: { order_id: "AUD-ABCD" },
        },
      },
    }),
    null,
  );
  assert.equal(
    orderIdFromStripeEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "AUD-UNPAID",
          payment_status: "unpaid",
        },
      },
    }),
    null,
  );
});
