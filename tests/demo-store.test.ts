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
const rateLimit = await import("../app/server/rate-limit.ts").catch(() => null);

// Royer, October 8: "We don't have the items to actually sell, so we need a
// solution where we can test things out but not actually sell them."
const customer = {
  name: "Synthetic Buyer", email: "buyer@example.test", phone: "+1 202 555 0100",
  address: "1 Test Lane", zip: "10001", city: "Testville", country: "Dominican Republic",
};
const cart = [{ productId: "xx99-mark-two-headphones", quantity: 1 }];
const TOTAL_CENTS = 358_900;

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
    body: JSON.stringify({ requestKey: crypto.randomUUID(), payment: "element", pickupCity: "", items: cart, ...overrides }),
  });
}

function intent(orderId: string, id: string, status: string) {
  return {
    id, object: "payment_intent", status, livemode: false, currency: "usd", metadata: { order_id: orderId },
    amount: TOTAL_CENTS, amount_received: status === "succeeded" ? TOTAL_CENTS : 0, client_secret: `${id}_secret_x`,
  };
}

test("the store says it is a demo and never accepts a live Stripe key", async (t) => {
  await withDatabase(t);
  const features = await (await featuresRoute.GET()).json();
  assert.equal(features.demo, true, "Production is an explicit demo store");

  for (const [secret, publishable] of [
    ["sk_live_synthetic_never_real", "pk_live_synthetic_never_real"],
    ["rk_live_synthetic_never_real", "pk_test_synthetic_not_a_real_key"],
    ["sk_test_synthetic_not_a_real_key", "pk_live_synthetic_never_real"],
  ]) {
    process.env.STRIPE_SECRET_KEY = secret;
    process.env.STRIPE_PUBLISHABLE_KEY = publishable;
    assert.deepEqual(stripeEnv.stripePublicConfig(), { configured: false, blocked: "live", publishableKey: null }, `${secret.slice(0, 8)} + ${publishable.slice(0, 8)}`);
    assert.equal(stripeEnv.stripeSecretKey(), null);
  }
  const refused = await intentRoute.POST(new Request("http://localhost/api/stripe/payment-intent", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId: "AUD-0000000000", items: cart }),
  }));
  assert.equal(refused.status, 400);
});

test("the server never receives or keeps a name, email, phone or address", async (t) => {
  const database = await withDatabase(t);
  const withDetails = await ordersRoute.POST(orderRequest({ customer }));
  assert.equal(withDetails.status, 400, "An order carrying personal details is refused");
  const created = await ordersRoute.POST(orderRequest());
  assert.equal(created.status, 201);
  const { order } = await created.json();
  const { rows } = await database.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'audiophile_orders'`);
  const columns = rows.map((row) => row.column_name);
  for (const personal of ["customer_name", "email", "phone", "address", "zip", "city", "country"]) {
    assert.equal(columns.includes(personal), false, `No ${personal} column`);
  }

  // Payment starts from the order ID and its cart alone.
  t.mock.method(globalThis, "fetch", async () => Response.json(intent(order.id, "pi_synthetic_demo", "requires_payment_method")));
  const start = await intentRoute.POST(new Request("http://localhost/api/stripe/payment-intent", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.id, items: cart }),
  }));
  assert.equal(start.status, 200);
});

test("unpaid orders are purged after seven days; paid ones, and ones holding money, stay", async (t) => {
  const database = await withDatabase(t);
  assert.ok(purgeRoute, "A scheduled purge route exists");
  process.env.CRON_SECRET = "synthetic-cron-secret-0123456789";
  const place = async (payment = "element") => (await (await ordersRoute.POST(orderRequest({ payment }))).json()).order.id as string;
  const stalePending = await place();
  const staleTransfer = await place("transfer");
  const stalePaid = await place();
  const staleOpenCard = await place();
  const staleProcessing = await place();
  const staleOvercharged = await place();
  const staleHostedOpen = await place("hosted");
  const staleHostedPaid = await place("hosted");
  const freshPending = await place();
  const cancelled: string[] = [];
  const hosted = (id: string, orderId: string, status: string, paymentStatus: string) => Response.json({
    id, object: "checkout.session", livemode: false, client_reference_id: orderId, currency: "usd",
    amount_total: TOTAL_CENTS, status, payment_status: paymentStatus,
    payment_intent: paymentStatus === "paid" ? "pi_hosted_paid" : null,
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    // A recent hosted page: the open one is closed; the other was paid meanwhile.
    if (path === "/v1/checkout/sessions/cs_test_open/expire") return hosted("cs_test_open", staleHostedOpen, "expired", "unpaid");
    if (path === "/v1/checkout/sessions/cs_test_paid/expire") return Response.json({ error: { message: "complete" } }, { status: 400 });
    if (path === "/v1/checkout/sessions/cs_test_paid") return hosted("cs_test_paid", staleHostedPaid, "complete", "paid");
    if (path.endsWith("/cancel")) {
      const id = path.split("/")[3];
      if (id === "pi_processing") return Response.json({ error: { message: "processing" } }, { status: 400 });
      cancelled.push(id);
      return Response.json(intent(staleOpenCard, id, "canceled"));
    }
    if (path === "/v1/payment_intents/pi_processing") return Response.json(intent(staleProcessing, "pi_processing", "processing"));
    if (init.method === "POST") return Response.json(intent(staleOpenCard, "pi_open", "requires_payment_method"));
    return Response.json(intent(staleOpenCard, "pi_open", "requires_payment_method"));
  });
  const startCard = (orderId: string) => intentRoute.POST(new Request("http://localhost/api/stripe/payment-intent", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, items: cart }),
  }));
  assert.equal((await startCard(staleOpenCard)).status, 200);
  await database.query(`insert into "audiophile_payments" ("payment_intent_id", "order_id", "status", "amount_cents", "currency")
    values ('pi_processing', $1, 'requires_payment_method', $2, 'usd')`, [staleProcessing, TOTAL_CENTS]);
  await webhookRoute.POST(await signedWebhook({
    id: "evt_demo_paid", type: "payment_intent.succeeded", livemode: false,
    data: { object: intent(stalePaid, "pi_demo_paid", "succeeded") },
  }));
  // A charge for the wrong amount leaves the order unpaid but holds money.
  await webhookRoute.POST(await signedWebhook({
    id: "evt_demo_short", type: "payment_intent.succeeded", livemode: false,
    data: { object: { ...intent(staleOvercharged, "pi_demo_short", "succeeded"), amount: 100, amount_received: 100 } },
  }));
  await database.query(`insert into "audiophile_checkout_sessions" ("session_id", "order_id") values ('cs_test_open', $1), ('cs_test_paid', $2)`,
    [staleHostedOpen, staleHostedPaid]);
  await database.query(`update "audiophile_orders" set "created_at" = now() - interval '8 days' where "id" <> $1`, [freshPending]);
  await database.query(`insert into "audiophile_rate_limits" ("bucket", "window_start", "hits") values ($1, now() - interval '2 days', 3)`, ["a".repeat(64)]);

  const refused = await purgeRoute.GET(new Request("http://localhost/api/cron/purge-orders"));
  assert.equal(refused.status, 401, "Only Vercel Cron, with the secret, can purge");
  const purged = await purgeRoute.GET(new Request("http://localhost/api/cron/purge-orders", {
    headers: { authorization: "Bearer synthetic-cron-secret-0123456789" },
  }));
  assert.equal(purged.status, 200);
  const result = await purged.json();
  assert.equal(result.purgedOrders, 4, "pending, transfer, the cancelled card order and the closed hosted page's order");
  assert.equal(result.expiredPages, 1);
  assert.equal(result.purgedRateLimitWindows, 1);
  assert.deepEqual(cancelled, ["pi_open"], "The open card attempt was cancelled before its order was deleted");
  const { rows } = await database.query(`select "id" from "audiophile_orders"`);
  assert.deepEqual(rows.map((row) => row.id).sort(), [stalePaid, staleProcessing, staleOvercharged, staleHostedPaid, freshPending].sort());
  const paidMeanwhile = await database.query(`select "status" from "audiophile_orders" where "id" = $1`, [staleHostedPaid]);
  assert.equal(paidMeanwhile.rows[0].status, "paid", "A hosted page paid before the purge settles its order");
  void stalePending; void staleTransfer;
});

test("order creation and payment starts are rate limited per address and per browser session", async (t) => {
  await withDatabase(t);
  assert.ok(rateLimit, "A rate limiter exists");
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    statuses.push((await ordersRoute.POST(orderRequest({}, { "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": `198.18.0.${attempt}` }))).status);
  }
  assert.ok(statuses.includes(429), "One address cannot keep creating orders, whatever x-forwarded-for says");
  const limited = await ordersRoute.POST(orderRequest({}, { "x-vercel-forwarded-for": "203.0.113.9" }));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  const message = (await limited.json()).error as string;
  assert.match(message, /^Too many orders from this browser or connection\. Try again in \d+ minutes?\.$/);
  assert.doesNotMatch(message, /\b1 minutes\b/);

  // An IPv6 client rotating addresses inside its /64 is one client.
  const ipv6: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    ipv6.push((await ordersRoute.POST(orderRequest({}, { "x-vercel-forwarded-for": `2001:db8:1:2::${attempt + 1}` }))).status);
  }
  assert.ok(ipv6.includes(429), "IPv6 addresses are counted per /64");
  assert.equal(rateLimit.clientAddress(new Request("http://x", { headers: { "x-vercel-forwarded-for": "::ffff:192.0.2.1" } })), "192.0.2.1");

  // One browser session cycling addresses is limited too.
  const first = await ordersRoute.POST(orderRequest({}, { "x-vercel-forwarded-for": "198.51.100.1" }));
  const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^audiophile_session=/);
  assert.match(first.headers.get("set-cookie") ?? "", /HttpOnly/);
  const sessionStatuses: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    sessionStatuses.push((await ordersRoute.POST(orderRequest({}, { "x-vercel-forwarded-for": `198.51.100.${attempt + 2}`, cookie }))).status);
  }
  assert.ok(sessionStatuses.includes(429), "One browser session cannot keep creating orders");

  const starts: number[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    starts.push((await intentRoute.POST(new Request("http://localhost/api/stripe/payment-intent", {
      method: "POST", headers: { "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.7" },
      body: JSON.stringify({ orderId: "AUD-0000000000", items: cart }),
    }))).status);
  }
  assert.ok(starts.includes(429), "Payment starts are limited per address");
});

test("the expand migration keeps old orders, and the contract step removes their personal details", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readMigrations } = await import("../scripts/migrations.mjs");
  const all = await readMigrations();
  const db = await PGlite.create();
  try {
    for (const migration of all.filter((item: { name: string }) => item.name < "0004")) await db.exec(migration.sql);
    // A pre-demo order with personal details, written the old way.
    await db.query(`insert into "audiophile_orders" ("id", "request_key", "status", "payment_method", "pickup_city",
        "customer_name", "email", "phone", "address", "zip", "city", "country",
        "subtotal_cents", "shipping_cents", "tax_cents", "total_cents")
      values ('AUD-0000000001', gen_random_uuid(), 'paid', 'element', '', 'Old Buyer', 'old@example.test', '1', 'Old Street', '1', 'Old City', 'Oldland', 100, 0, 0, 100)`);
    const expand = all.find((item: { name: string }) => item.name.startsWith("0004"));
    await db.exec(expand.sql);
    await db.exec(expand.sql);
    // The new code writes no personal details; the old shape still accepts it.
    await db.query(`insert into "audiophile_orders" ("id", "request_key", "status", "payment_method", "pickup_city",
        "subtotal_cents", "shipping_cents", "tax_cents", "total_cents")
      values ('AUD-0000000002', gen_random_uuid(), 'pending_hosted', 'element', '', 100, 0, 0, 100)`);
    const contract = all.find((item: { name: string }) => item.name.startsWith("0005"));
    await db.exec(contract.sql);
    await db.exec(contract.sql);
    await db.exec(expand.sql);
    const { rows } = await db.query<{ id: string }>(`select * from "audiophile_orders" order by "id"`);
    assert.deepEqual(rows.map((row) => row.id), ["AUD-0000000001", "AUD-0000000002"]);
    assert.doesNotMatch(JSON.stringify(rows), /Old Buyer|old@example\.test|Old Street|Oldland/);
  } finally {
    await db.close();
  }
});
