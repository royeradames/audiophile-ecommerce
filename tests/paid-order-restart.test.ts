import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { simulateRestart, startTestDatabase } from "./support/database.ts";
import { signedWebhook } from "./support/stripe.ts";

register("./typescript-loader.mjs", import.meta.url);

// Regression: the paid-order record lived in server memory, so a restart or a
// new serverless instance forgot that Stripe had reported a payment.
test("a paid order is still listed after the server restarts", async (t) => {
  const database = await startTestDatabase();
  t.after(() => database.close());
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_audiophile";
  delete process.env.STAFF_PASSWORD;

  // Durable orders exist only on the server, so place one first when the app
  // has that route. The original build accepted any AUD- id from Stripe.
  const orders = await import("../app/api/orders/route.ts").catch(() => null);
  let orderId = "AUD-RESTART";
  let amount = 358_900;
  if (orders) {
    const created = await orders.POST(new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestKey: "6d5c1f7e-0f4a-4d1b-9c55-1e0c7c1b2a01",
        payment: "element",
        pickupCity: "",
        items: [{ productId: "xx99-mark-two-headphones", quantity: 1 }],
      }),
    }));
    assert.equal(created.status, 201);
    const body = await created.json();
    orderId = body.order.id;
    amount = Math.round(body.order.grandTotal * 100);
  }

  const webhook = await import("../app/api/stripe/webhook/route.ts");
  const delivered = await webhook.POST(await signedWebhook({
    id: "evt_restart_regression",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: {
      id: "pi_restart_regression", object: "payment_intent", status: "succeeded", livemode: false,
      amount, amount_received: amount, currency: "usd", metadata: { order_id: orderId },
    } },
  }));
  assert.equal(delivered.status, 200);

  await simulateRestart();

  const paid = await import("../app/api/stripe/paid/route.ts");
  const response = await paid.GET(new Request("http://localhost/api/stripe/paid"));
  assert.equal(response.status, 200);
  const { orders: listed } = await response.json() as { orders: Array<{ orderId: string }> };
  assert.deepEqual(listed.map((entry) => entry.orderId), [orderId], "The paid order must survive the restart");
});
