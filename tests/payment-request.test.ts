import assert from "node:assert/strict";
import { register } from "node:module";
import test, { type TestContext } from "node:test";

register("./typescript-loader.mjs", import.meta.url);
const checkout = await import("../app/api/stripe/checkout/route.ts");
const paymentIntent = await import("../app/api/stripe/payment-intent/route.ts");

const requestBody = {
  orderId: "AUD-TEST",
  email: "synthetic@example.invalid",
  items: [{ productId: "xx99-mark-two-headphones", quantity: 1 }],
};
const endpoints = [
  { name: "Checkout", post: checkout.POST, path: "checkout" },
  { name: "PaymentIntent", post: paymentIntent.POST, path: "payment-intent" },
];

function testKeys(t: TestContext) {
  const previous = { ...process.env };
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_not_a_real_key";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_not_a_real_key";
  t.after(() => { process.env = previous; });
}

for (const endpoint of endpoints) {
  test(`${endpoint.name} rejects a browser-supplied amount before contacting Stripe`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      assert.fail("Rejected payment input must not contact Stripe");
    });
    testKeys(t);
    const response = await endpoint.post(new Request(`https://shop.example/api/stripe/${endpoint.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, amount: 1 }),
    }));
    assert.equal(response.status, 400);
  });

  test(`${endpoint.name} charges catalog price plus unchanged demo shipping and tax`, async (t) => {
    testKeys(t);
    let stripeCalls = 0;
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      stripeCalls += 1;
      assert.equal(url, endpoint.path === "checkout" ? "https://api.stripe.com/v1/checkout/sessions" : "https://api.stripe.com/v1/payment_intents");
      assert.ok(init.body instanceof URLSearchParams);
      assert.equal(init.body.get(endpoint.path === "checkout" ? "line_items[0][price_data][unit_amount]" : "amount"), "358900");
      if (endpoint.path === "checkout") {
        assert.equal(init.body.get("line_items[0][price_data][product_data][description]"), "1× XX99 MK II");
      }
      return Response.json({ url: "https://checkout.stripe.com/synthetic", client_secret: "synthetic_secret" });
    });
    const response = await endpoint.post(new Request(`https://shop.example/api/stripe/${endpoint.path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody),
    }));
    assert.equal(response.status, 200);
    assert.equal(stripeCalls, 1);
    if (endpoint.path === "payment-intent") assert.equal((await response.json()).amount, 3589);
  });
}

test("browser payment clients send only the order ID and product quantities, never the email", async (t) => {
  const { startHostedCheckout, createPaymentIntent } = await import("../app/stripe-client.ts");
  const clientInput = { ...requestBody, amount: 1, description: "forged", items: [{ ...requestBody.items[0], unitPrice: 1 }] };
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(typeof init.body, "string");
    assert.deepEqual(JSON.parse(String(init.body)), { orderId: requestBody.orderId, items: requestBody.items });
    return Response.json({ url: "https://checkout.stripe.com/synthetic", clientSecret: "synthetic_secret", amount: 3589 });
  });
  assert.equal((await startHostedCheckout(clientInput)).ok, true);
  const intent = await createPaymentIntent(clientInput);
  assert.equal(intent.ok, true);
  if (intent.ok) assert.equal(intent.amount, 3589);
});

for (const endpoint of endpoints) {
  test(`${endpoint.name} rejects malformed, tampered, and unbounded input without a Stripe call`, async (t) => {
    testKeys(t);
    let stripeCalls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      stripeCalls += 1;
      return Response.json({ url: "https://checkout.stripe.com/synthetic", client_secret: "synthetic_secret" });
    });
    const invalidBodies: [string, unknown][] = [
      ["null", null], ["array", []], ["missing items", { orderId: "AUD-TEST", email: requestBody.email }],
      ["empty cart", { ...requestBody, items: [] }],
      ["unknown product", { ...requestBody, items: [{ productId: "missing", quantity: 1 }] }],
      ["duplicate product", { ...requestBody, items: [...requestBody.items, ...requestBody.items] }],
      ["forged price", { ...requestBody, items: [{ ...requestBody.items[0], unitPrice: 1 }] }],
      ["forged description", { ...requestBody, description: "Fake description" }],
      ["forged total", { ...requestBody, amount: 1 }],
      ["bad email", { ...requestBody, email: "invalid" }],
      ["long email", { ...requestBody, email: `${"a".repeat(255)}@example.invalid` }],
      ["bad order ID", { ...requestBody, orderId: "AUD-<script>" }],
      ["long order ID", { ...requestBody, orderId: `AUD-${"A".repeat(65)}` }],
      ["quantity type", { ...requestBody, items: [{ ...requestBody.items[0], quantity: "1" }] }],
      ...[0, -1, 1.5, 100, Number.MAX_SAFE_INTEGER].map((quantity): [string, unknown] => [
        `quantity ${quantity}`, { ...requestBody, items: [{ ...requestBody.items[0], quantity }] },
      ]),
      ["provider maximum", { ...requestBody, items: [
        { productId: "xx99-mark-two-headphones", quantity: 99 },
        { productId: "zx7-speaker", quantity: 99 },
        { productId: "zx9-speaker", quantity: 99 },
      ] }],
    ];
    for (const [name, body] of invalidBodies) {
      const response = await endpoint.post(new Request(`https://shop.example/api/stripe/${endpoint.path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      assert.equal(response.status, 400, name);
      assert.equal(typeof (await response.json()).error, "string");
    }
    for (const [name, body, status] of [
      ["invalid JSON", "{", 400], ["oversize actual bytes", `{"padding":"${"a".repeat(16_384)}"}`, 413],
    ] as const) {
      const response = await endpoint.post(new Request(`https://shop.example/api/stripe/${endpoint.path}`, {
        method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body,
      }));
      assert.equal(response.status, status, name);
    }
    const wrongContentType = await endpoint.post(new Request("https://shop.example", { method: "POST", body: JSON.stringify(requestBody) }));
    assert.equal(wrongContentType.status, 415);
    const oversizedHeader = await endpoint.post(new Request("https://shop.example", {
      method: "POST", body: "{}", headers: { "content-type": "application/json", "content-length": "16385" },
    }));
    assert.equal(oversizedHeader.status, 413);
    assert.equal(stripeCalls, 0);
  });

  test(`${endpoint.name} calculates multi-product quantities once and hides provider errors`, async (t) => {
    testKeys(t);
    const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      assert.ok(init.body instanceof URLSearchParams);
      assert.equal(init.body.get(endpoint.path === "checkout" ? "line_items[0][price_data][unit_amount]" : "amount"), "252400");
      return Response.json({ url: "https://checkout.stripe.com/synthetic", client_secret: "synthetic_secret" });
    });
    const makeRequest = () => new Request("https://shop.example", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...requestBody, items: [
        { productId: "yx1-earphones", quantity: 2 }, { productId: "xx59-headphones", quantity: 1 },
      ] }),
    });
    assert.equal((await endpoint.post(makeRequest())).status, 200);
    fetchMock.mock.mockImplementation(async () => { throw new Error("private provider diagnostic"); });
    const failure = await endpoint.post(makeRequest());
    assert.equal(failure.status, 502);
    assert.doesNotMatch(await failure.text(), /private provider diagnostic/);
  });

  test(`${endpoint.name} retains missing and live-key barriers`, async (t) => {
    testKeys(t);
    let stripeCalls = 0;
    t.mock.method(globalThis, "fetch", async () => { stripeCalls += 1; return Response.json({}); });
    delete process.env.STRIPE_SECRET_KEY;
    const request = () => new Request("https://shop.example", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody),
    });
    assert.equal((await endpoint.post(request())).status, 503);
    process.env.STRIPE_SECRET_KEY = "sk_live_synthetic_not_a_real_key";
    assert.equal((await endpoint.post(request())).status, 400);
    assert.equal(stripeCalls, 0);
  });
}

test("browser payment clients report invalid responses and network failures safely", async (t) => {
  const { startHostedCheckout, createPaymentIntent } = await import("../app/stripe-client.ts");
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ clientSecret: "synthetic_secret", amount: -1 }));
  assert.equal((await createPaymentIntent(requestBody)).ok, false);
  fetchMock.mock.mockImplementation(async () => new Response("bad JSON"));
  assert.equal((await startHostedCheckout(requestBody)).ok, false);
  fetchMock.mock.mockImplementation(async () => { throw new Error("private network diagnostic"); });
  const result = await createPaymentIntent(requestBody);
  assert.equal(result.ok, false);
  if (!result.ok) assert.doesNotMatch(result.error, /private network diagnostic/);
});
