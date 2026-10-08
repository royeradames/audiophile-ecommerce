import assert from "node:assert/strict";
import { register } from "node:module";
import test, { type TestContext } from "node:test";
import { startTestDatabase } from "./support/database.ts";
import { signedWebhook } from "./support/stripe.ts";

register("./typescript-loader.mjs", import.meta.url);
const ordersRoute = await import("../app/api/orders/route.ts");
const intentRoute = await import("../app/api/stripe/payment-intent/route.ts");
const webhookRoute = await import("../app/api/stripe/webhook/route.ts");
const featuresRoute = await import("../app/api/store/features/route.ts");
const stripeEnv = await import("../app/stripe-env.ts");
const purgeRoute = await import("../app/api/cron/purge-orders/route.ts").catch(() => null);

// Royer, October 8: "We don't have the items to actually sell, so we need a
// solution where we can test things out but not actually sell them."
const customer = {
  name: "Synthetic Buyer", email: "buyer@example.test", phone: "+1 202 555 0100",
  address: "1 Test Lane", zip: "10001", city: "Testville", country: "Dominican Republic",
};
const cart = [{ productId: "xx99-mark-two-headphones", quantity: 1 }];

async function withDatabase(t: TestContext) {
  const database = await startTestDatabase();
  const previous = { ...process.env };
  t.after(async () => {
    await database.close();
    for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "CRON_SECRET"]) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  });
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_not_a_real_key";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_not_a_real_key";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_audiophile";
  return database;
}

function orderRequest(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ requestKey: crypto.randomUUID(), payment: "element", pickupCity: "", customer, items: cart, ...overrides }),
  });
}

test("the store says it is a demo and never accepts a live Stripe key", async (t) => {
  await withDatabase(t);
  const features = await (await featuresRoute.GET()).json();
  assert.equal(features.demo, true, "Production is an explicit demo store");

  process.env.STRIPE_SECRET_KEY = "sk_live_synthetic_never_real";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_synthetic_never_real";
  assert.deepEqual(stripeEnv.stripePublicConfig(), { configured: false, blocked: "live", publishableKey: null });
  assert.equal(stripeEnv.stripeSecretKey(), null);
  const refused = await intentRoute.POST(new Request("http://localhost/api/stripe/payment-intent", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId: "AUD-0000000000", email: customer.email, items: cart }),
  }));
  assert.equal(refused.status, 400);
});

test("an order keeps no name, email, phone or address on the server", async (t) => {
  const database = await withDatabase(t);
  const created = await ordersRoute.POST(orderRequest());
  assert.equal(created.status, 201);
  const { order } = await created.json();
  const { rows } = await database.query(`select * from "audiophile_orders" where "id" = $1`, [order.id]);
  const stored = JSON.stringify(rows[0]);
  for (const value of [customer.name, customer.email, customer.phone, customer.address, customer.zip, customer.city]) {
    assert.equal(stored.includes(value), false, `The order row must not keep "${value}"`);
  }
  assert.equal(rows[0].country, customer.country, "The country stays for the tax label");

  // Payment starts from the order ID and its cart; no stored email is needed.
  t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "pi_synthetic_demo", object: "payment_intent", status: "requires_payment_method", livemode: false,
    amount: 358_900, currency: "usd", client_secret: "pi_synthetic_demo_secret_x", metadata: { order_id: order.id },
  }));
  const start = await intentRoute.POST(new Request("http://localhost/api/stripe/payment-intent", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.id, items: cart }),
  }));
  assert.equal(start.status, 200);
});

test("unpaid orders are purged after seven days; paid orders stay", async (t) => {
  const database = await withDatabase(t);
  assert.ok(purgeRoute, "A scheduled purge route exists");
  process.env.CRON_SECRET = "synthetic-cron-secret-0123456789";
  const place = async () => (await (await ordersRoute.POST(orderRequest())).json()).order.id as string;
  const [stalePending, staleTransfer, stalePaid, freshPending] = [await place(), await place(), await place(), await place()];
  await webhookRoute.POST(await signedWebhook({
    id: "evt_demo_paid", type: "payment_intent.succeeded", livemode: false,
    data: { object: { id: "pi_demo_paid", status: "succeeded", livemode: false, amount: 358_900, amount_received: 358_900, currency: "usd", metadata: { order_id: stalePaid } } },
  }));
  await database.query(`update "audiophile_orders" set "status" = 'pending_transfer' where "id" = $1`, [staleTransfer]);
  await database.query(`update "audiophile_orders" set "created_at" = now() - interval '8 days' where "id" = any($1)`,
    [[stalePending, staleTransfer, stalePaid]]);

  const refused = await purgeRoute.GET(new Request("http://localhost/api/cron/purge-orders"));
  assert.equal(refused.status, 401, "Only Vercel Cron, with the secret, can purge");
  const purged = await purgeRoute.GET(new Request("http://localhost/api/cron/purge-orders", {
    headers: { authorization: "Bearer synthetic-cron-secret-0123456789" },
  }));
  assert.equal(purged.status, 200);
  assert.equal((await purged.json()).purgedOrders, 2);
  const { rows } = await database.query(`select "id" from "audiophile_orders" order by "id"`);
  assert.deepEqual(rows.map((row) => row.id).sort(), [freshPending, stalePaid].sort());
});

test("order creation and payment starts are rate limited per IP and per browser session", async (t) => {
  await withDatabase(t);
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    statuses.push((await ordersRoute.POST(orderRequest({}, { "x-forwarded-for": "203.0.113.9" }))).status);
  }
  assert.ok(statuses.includes(429), "One address cannot keep creating orders");
  const limited = await ordersRoute.POST(orderRequest({}, { "x-forwarded-for": "203.0.113.9" }));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.doesNotMatch(await limited.text(), /error:|stack|at /i);

  // One browser session cycling addresses is limited too.
  const first = await ordersRoute.POST(orderRequest({}, { "x-forwarded-for": "198.51.100.1" }));
  const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^audiophile_session=/);
  const sessionStatuses: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    sessionStatuses.push((await ordersRoute.POST(orderRequest({}, { "x-forwarded-for": `198.51.100.${attempt + 2}`, cookie }))).status);
  }
  assert.ok(sessionStatuses.includes(429), "One browser session cannot keep creating orders");

  const starts: number[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    starts.push((await intentRoute.POST(new Request("http://localhost/api/stripe/payment-intent", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.7" },
      body: JSON.stringify({ orderId: "AUD-0000000000", email: customer.email, items: cart }),
    }))).status);
  }
  assert.ok(starts.includes(429), "Payment starts are limited per address");
});
