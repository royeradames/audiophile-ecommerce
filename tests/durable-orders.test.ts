import assert from "node:assert/strict";
import { register } from "node:module";
import test, { type TestContext } from "node:test";
import { simulateRestart, startTestDatabase } from "./support/database.ts";
import { signedWebhook } from "./support/stripe.ts";

register("./typescript-loader.mjs", import.meta.url);
const ordersRoute = await import("../app/api/orders/route.ts");
const orderRoute = await import("../app/api/orders/[orderId]/route.ts");
const intentRoute = await import("../app/api/stripe/payment-intent/route.ts");
const checkoutRoute = await import("../app/api/stripe/checkout/route.ts");
const webhookRoute = await import("../app/api/stripe/webhook/route.ts");
const featuresRoute = await import("../app/api/store/features/route.ts");
const store = await import("../app/server/order-store.ts");
const migrations = await import("../scripts/migrations.mjs");

const customer = {
  name: "Synthetic Buyer", email: "buyer@example.test", phone: "+1 202 555 0100",
  address: "1 Test Lane", zip: "10001", city: "Testville", country: "Testland",
};
const cart = [{ productId: "xx99-mark-two-headphones", quantity: 1 }];
const XX99_TOTAL_CENTS = 358_900; // $2,999 + $50 demo shipping + $540 demo ITBIS (18%)

function keys(t: TestContext) {
  const previous = { ...process.env };
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_not_a_real_key";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_not_a_real_key";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_audiophile";
  delete process.env.STAFF_PASSWORD;
  t.after(() => {
    for (const name of ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"]) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  });
}

async function withDatabase(t: TestContext) {
  const database = await startTestDatabase();
  t.after(() => database.close());
  keys(t);
  return database;
}

function json(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function placeOrder(overrides: Record<string, unknown> = {}) {
  const response = await ordersRoute.POST(json("http://localhost/api/orders", {
    requestKey: crypto.randomUUID(), payment: "element", pickupCity: "", customer, items: cart, ...overrides,
  }));
  return { status: response.status, body: await response.json() };
}

function intentEvent(eventId: string, orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: eventId, type: "payment_intent.succeeded", livemode: false,
    data: { object: {
      id: "pi_synthetic_1", object: "payment_intent", status: "succeeded", livemode: false,
      amount: XX99_TOTAL_CENTS, amount_received: XX99_TOTAL_CENTS, currency: "usd",
      metadata: { order_id: orderId }, ...overrides,
    } },
  };
}

test("the store reports durable orders when a database is configured", async (t) => {
  await withDatabase(t);
  const response = await featuresRoute.GET();
  assert.deepEqual(await response.json(), { demo: true, durableOrders: true, accounts: "coming_soon" });
});

test("an order is created from server prices, ignoring any browser total", async (t) => {
  const database = await withDatabase(t);
  const created = await placeOrder({ items: [{ productId: "xx99-mark-two-headphones", quantity: 2 }] });
  assert.equal(created.status, 201);
  const { order } = created.body;
  assert.match(order.id, /^AUD-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.equal(order.status, "pending_hosted");
  assert.deepEqual([order.subtotal, order.shipping, order.vat, order.grandTotal], [5998, 50, 1080, 7128]);
  assert.equal(order.savedToAccount, false);
  const { rows } = await database.query(`select "total_cents", "customer_id" from "audiophile_orders"`);
  assert.deepEqual(rows, [{ total_cents: 712_800, customer_id: null }]);

  const forged = await placeOrder({ total: 1 });
  assert.equal(forged.status, 400, "Unknown fields such as a browser total are refused");
  const unknown = await placeOrder({ items: [{ productId: "not-in-catalog", quantity: 1 }] });
  assert.equal(unknown.status, 400);
});

test("submitting the same checkout twice keeps a single order", async (t) => {
  const database = await withDatabase(t);
  const requestKey = crypto.randomUUID();
  const first = await placeOrder({ requestKey });
  const again = await placeOrder({ requestKey });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.order.id, first.body.order.id);

  const changed = await placeOrder({ requestKey, items: [{ productId: "yx1-earphones", quantity: 1 }] });
  assert.equal(changed.status, 409, "A reused key with a different cart is refused, not merged");
  const { rows } = await database.query(`select count(*)::int as "count" from "audiophile_orders"`);
  assert.equal(rows[0].count, 1);
});

test("a cancelled card form and a retry reuse one order and one open PaymentIntent", async (t) => {
  const database = await withDatabase(t);
  const { body } = await placeOrder();
  const orderId = body.order.id;
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    if (init.method === "POST") {
      assert.equal((init.headers as Record<string, string>)["idempotency-key"], `audiophile:${orderId}:intent:0`);
      assert.equal((init.body as URLSearchParams).get("amount"), String(XX99_TOTAL_CENTS));
    }
    return Response.json({
      // The account's API version still says requires_source for requires_payment_method.
      id: "pi_synthetic_retry", object: "payment_intent", status: "requires_source", livemode: false,
      amount: XX99_TOTAL_CENTS, currency: "usd", client_secret: "pi_synthetic_retry_secret_x", metadata: { order_id: orderId },
    });
  });
  const start = () => intentRoute.POST(json("http://localhost/api/stripe/payment-intent", { orderId, email: customer.email, items: cart }));

  const first = await start();
  assert.equal(first.status, 200);
  // The shopper closes the card form, then comes back to pay the same order.
  const retry = await start();
  assert.equal(retry.status, 200);
  assert.equal((await first.json()).clientSecret, (await retry.json()).clientSecret);
  assert.deepEqual(calls, [
    "POST https://api.stripe.com/v1/payment_intents",
    "GET https://api.stripe.com/v1/payment_intents/pi_synthetic_retry",
  ]);
  const counts = await database.query(`select
    (select count(*)::int from "audiophile_orders") as "orders",
    (select count(*)::int from "audiophile_payments") as "payments"`);
  assert.deepEqual(counts.rows[0], { orders: 1, payments: 1 });
});

test("hosted Checkout charges the stored total and refuses a mismatched cart", async (t) => {
  await withDatabase(t);
  const { body } = await placeOrder({ payment: "hosted" });
  let charged = "";
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    charged = (init.body as URLSearchParams).get("line_items[0][price_data][unit_amount]") ?? "";
    return Response.json({ id: "cs_test_synthetic", url: "https://checkout.stripe.com/synthetic", livemode: false });
  });
  const ok = await checkoutRoute.POST(json("http://localhost/api/stripe/checkout", { orderId: body.order.id, email: customer.email, items: cart }));
  assert.equal(ok.status, 200);
  assert.equal(charged, String(XX99_TOTAL_CENTS));

  const otherCart = await checkoutRoute.POST(json("http://localhost/api/stripe/checkout", {
    orderId: body.order.id, email: customer.email, items: [{ productId: "yx1-earphones", quantity: 1 }],
  }));
  assert.equal(otherCart.status, 409);
  const missing = await checkoutRoute.POST(json("http://localhost/api/stripe/checkout", {
    orderId: "AUD-0000000000", email: customer.email, items: cart,
  }));
  assert.equal(missing.status, 404);
});

test("a retry after an unrecorded successful card payment settles the order instead of charging again", async (t) => {
  const database = await withDatabase(t);
  const { body } = await placeOrder();
  const orderId = body.order.id;
  let stripeStatus = "requires_payment_method";
  const created: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") created.push(url);
    return Response.json({
      id: "pi_synthetic_paid", object: "payment_intent", status: stripeStatus, livemode: false,
      amount: XX99_TOTAL_CENTS, amount_received: stripeStatus === "succeeded" ? XX99_TOTAL_CENTS : 0, currency: "usd",
      client_secret: "pi_synthetic_paid_secret_x", metadata: { order_id: orderId },
    });
  });
  const start = () => intentRoute.POST(json("http://localhost/api/stripe/payment-intent", { orderId, email: customer.email, items: cart }));
  assert.equal((await start()).status, 200);

  // Stripe took the payment, but neither the return call nor the webhook reached the store.
  stripeStatus = "processing";
  const processing = await start();
  assert.equal(processing.status, 409, "A processing payment blocks a second charge");
  stripeStatus = "succeeded";
  const retry = await start();
  assert.equal(retry.status, 409);
  assert.match((await retry.json()).error, /already paid/);
  assert.equal(created.length, 1, "Only the first request created a PaymentIntent");
  const { rows } = await database.query(`select "status" from "audiophile_orders" where "id" = $1`, [orderId]);
  assert.equal(rows[0].status, "paid", "The retry recorded the payment Stripe already took");
});

test("a new hosted Checkout page closes the earlier one, and a paid page settles the order", async (t) => {
  const database = await withDatabase(t);
  const { body } = await placeOrder({ payment: "hosted" });
  const orderId = body.order.id;
  const sessions = new Map<string, { status: string; payment_status: string }>();
  const calls: string[] = [];
  const byKey = new Map<string, string>();
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method} ${path}`);
    if (path === "/v1/checkout/sessions") {
      // Like Stripe, a repeated idempotency key returns the first session.
      const key = (init.headers as Record<string, string>)["idempotency-key"];
      const id = byKey.get(key) ?? `cs_test_synthetic_${sessions.size + 1}`;
      if (!byKey.has(key)) {
        byKey.set(key, id);
        sessions.set(id, { status: "open", payment_status: "unpaid" });
      }
      return Response.json({ id, url: `https://checkout.stripe.com/${id}`, livemode: false });
    }
    const id = path.split("/")[4];
    const session = sessions.get(id)!;
    if (path.endsWith("/expire")) session.status = "expired";
    return Response.json({
      id, object: "checkout.session", livemode: false, client_reference_id: orderId, currency: "usd",
      amount_total: XX99_TOTAL_CENTS, payment_intent: session.payment_status === "paid" ? "pi_synthetic_hosted" : null, ...session,
    });
  });
  const start = () => checkoutRoute.POST(json("http://localhost/api/stripe/checkout", { orderId, email: customer.email, items: cart }));

  // Two tabs (or a double click) at once get one page.
  const [first, twin] = await Promise.all([start(), start()]);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).url, (await twin.json()).url);
  assert.equal(sessions.size, 1);
  assert.equal((await start()).status, 200, "Retrying after a cancel opens a new page");
  assert.equal(sessions.get("cs_test_synthetic_1")?.status, "expired", "The earlier page can no longer take payment");

  // The shopper pays on the second page; the return call never arrives.
  Object.assign(sessions.get("cs_test_synthetic_2")!, { status: "complete", payment_status: "paid" });
  const third = await start();
  assert.equal(third.status, 409);
  const { rows } = await database.query(`select "status" from "audiophile_orders" where "id" = $1`, [orderId]);
  assert.equal(rows[0].status, "paid");
  assert.equal(sessions.size, 2);

  const wrongMethod = await intentRoute.POST(json("http://localhost/api/stripe/payment-intent", { orderId, email: customer.email, items: cart }));
  assert.equal(wrongMethod.status, 409, "A hosted-card order cannot also open the card form");
});

test("a broken account setting keeps checkout working and shows accounts as coming soon", async (t) => {
  await withDatabase(t);
  const previous = { ...process.env };
  t.after(() => {
    for (const name of ["AUTH_BASE_URL", "AUTH_SECRET", "AUTH_ISSUER_URL", "AUTH_CLIENT_ID", "AUTH_CLIENT_SECRET"]) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  });
  Object.assign(process.env, {
    AUTH_BASE_URL: "https://shop.example", AUTH_SECRET: "too-short", AUTH_ISSUER_URL: "https://issuer.example/api/auth/",
    AUTH_CLIENT_ID: "synthetic", AUTH_CLIENT_SECRET: "synthetic",
  });
  assert.deepEqual(await (await featuresRoute.GET()).json(), { demo: true, durableOrders: true, accounts: "coming_soon" });
  assert.equal((await placeOrder()).status, 201);
});

test("a repeated webhook and the return page settle the order exactly once", async (t) => {
  const database = await withDatabase(t);
  const { body } = await placeOrder();
  const orderId = body.order.id;

  const first = await webhookRoute.POST(await signedWebhook(intentEvent("evt_synthetic_1", orderId)));
  assert.deepEqual(await first.json(), { received: true, orderId, outcome: "paid" });
  const duplicate = await webhookRoute.POST(await signedWebhook(intentEvent("evt_synthetic_1", orderId)));
  assert.equal((await duplicate.json()).outcome, "duplicate");

  // The return page confirms the same PaymentIntent with Stripe afterwards.
  t.mock.method(globalThis, "fetch", async () => Response.json(intentEvent("evt_unused", orderId).data.object));
  const confirmed = await intentRoute.GET(new Request("http://localhost/api/stripe/payment-intent?id=pi_synthetic_1"));
  assert.equal((await confirmed.json()).paid, true);

  const { rows } = await database.query(`select "status", "settled_at" from "audiophile_orders" where "id" = $1`, [orderId]);
  assert.equal(rows[0].status, "paid");
  const settledAt = rows[0].settled_at;
  const late = await webhookRoute.POST(await signedWebhook(intentEvent("evt_synthetic_2", orderId, { status: "processing" })));
  assert.equal((await late.json()).outcome, "recorded");
  const after = await database.query(`select o."status", o."settled_at", p."status" as "payment"
    from "audiophile_orders" o join "audiophile_payments" p on p."order_id" = o."id" where o."id" = $1`, [orderId]);
  assert.deepEqual(after.rows, [{ status: "paid", settled_at: settledAt, payment: "succeeded" }],
    "A late event never rolls a settled payment back");
});

test("a payment for the wrong amount, or from live mode, never settles an order", async (t) => {
  const database = await withDatabase(t);
  const { body } = await placeOrder();
  const orderId = body.order.id;
  const short = await webhookRoute.POST(await signedWebhook(intentEvent("evt_short", orderId, { amount: 100, amount_received: 100 })));
  assert.equal((await short.json()).outcome, "amount_mismatch");
  const live = await webhookRoute.POST(await signedWebhook({ ...intentEvent("evt_live", orderId), livemode: true }));
  assert.equal((await live.json()).ignored, true);
  const { rows } = await database.query(`select "status" from "audiophile_orders" where "id" = $1`, [orderId]);
  assert.equal(rows[0].status, "pending_hosted");
});

test("a paid order reads back after a restart without its private details", async (t) => {
  await withDatabase(t);
  const { body } = await placeOrder();
  const orderId = body.order.id;
  await webhookRoute.POST(await signedWebhook(intentEvent("evt_receipt", orderId)));
  await simulateRestart();

  const response = await orderRoute.GET(new Request(`http://localhost/api/orders/${orderId}`), { params: Promise.resolve({ orderId }) });
  assert.equal(response.status, 200);
  const { order } = await response.json();
  assert.equal(order.status, "paid");
  assert.equal(order.grandTotal, 3589);
  for (const field of ["email", "address", "phone", "customerId", "customer_name", "totalCents"]) {
    assert.equal(field in order, false, `${field} stays private`);
  }
  const paidAgain = await intentRoute.POST(json("http://localhost/api/stripe/payment-intent", { orderId, email: customer.email, items: cart }));
  assert.equal(paidAgain.status, 409, "A paid order cannot start another charge");
  const missing = await orderRoute.GET(new Request("http://localhost/api/orders/AUD-1"), { params: Promise.resolve({ orderId: "AUD-1" }) });
  assert.equal(missing.status, 404);
});

test("a customer's history holds only their own orders", async (t) => {
  const database = await withDatabase(t);
  await database.query(`insert into "user" ("id", "name", "email", "emailVerified") values
    ('user-a', 'A', 'a@example.test', true), ('user-b', 'B', 'b@example.test', true)`);
  const pool = (await import("../app/server/database.ts")).getDatabase();
  assert.ok(pool);
  const input = { requestKey: crypto.randomUUID(), payment: "transfer" as const, pickupCity: "" as const, customer, items: cart };
  const mine = await store.createOrder(pool, input, "user-a");
  await store.createOrder(pool, { ...input, requestKey: crypto.randomUUID() }, "user-b");
  await store.createOrder(pool, { ...input, requestKey: crypto.randomUUID() }, null);
  assert.ok(mine.ok);
  const history = await store.listCustomerOrders(pool, "user-a");
  assert.deepEqual(history.map((order) => order.id), [mine.order.id]);
  assert.equal(history[0].savedToAccount, true);

  // The account replays its own submission; another account cannot claim it.
  const replay = await store.createOrder(pool, input, "user-a");
  assert.ok(replay.ok && replay.replayed);
  const claimed = await store.createOrder(pool, input, "user-b");
  assert.equal(claimed.ok, false);
});

test("migrations apply once and are safe to run again", async (t) => {
  const database = await withDatabase(t);
  const all = await migrations.readMigrations();
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: database.url });
  await (await import("../app/server/database.ts")).getDatabase()?.end();
  delete (globalThis as { __audiophileDatabase?: unknown }).__audiophileDatabase;
  await client.connect();
  try {
    const second = await migrations.applyMigrations(client, all);
    assert.deepEqual(second, { applied: [], skipped: all.map((migration) => migration.name) });
    // Every statement is idempotent on its own, even outside the ledger.
    for (const migration of all) await client.query(migration.sql);
    const changed = all.map((migration, index) => index === 0 ? { ...migration, sha256: "edited" } : migration);
    await assert.rejects(migrations.applyMigrations(client, changed), /changed after it was applied/);
  } finally {
    await client.end();
  }
});
