import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished storefront", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Audiophile — Sound worth slowing down for/);
  assert.match(html, /XX99 Mark II headphones/i);
  assert.match(html, /Shop by category/i);
  assert.match(html, /Stripe test cards/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("server-renders the payment stack", async () => {
  const response = await render("/payments");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Payment stack/i);
  assert.match(html, /Banreservas/);
  assert.match(html, /Banco Popular/);
  assert.match(html, /Zelle/);
  assert.match(html, /Own card form/i);
  assert.match(html, /AZUL/i);
  assert.match(html, /Dev test/i);
});

test("server-renders the Zelle pay page", async () => {
  const response = await render("/zelle");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Pay with Zelle/i);
  assert.match(html, /Royer Adames/);
  assert.match(html, /zelle-qr\.png/);
  assert.match(html, /memo/i);
  assert.match(html, /<img/i);
});

test("server-renders the pending order queue", async () => {
  const response = await render("/orders");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Pending orders/i);
  assert.match(html, /Checking staff access|Owner queue|Staff password/i);
});

test("server-renders the Stripe test return page", async () => {
  const response = await render("/checkout/stripe");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Stripe/i);
});

test("server-renders category and product routes", async () => {
  const category = await render("/headphones");
  assert.equal(category.status, 200);
  assert.match(await category.text(), /Headphones \| Audiophile/);

  const product = await render("/headphones/xx99-mark-two-headphones");
  assert.equal(product.status, 200);
  const html = await product.text();
  assert.match(html, /Add to cart/i);
  assert.match(html, /In the box/i);
});

test("keeps state, privacy, accessibility, and legibility contracts explicit", async () => {
  const [cart, checkout, shell, css, packageJson, instructions, layout] = await Promise.all([
    readFile(new URL("../app/cart-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/checkout/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/payment-instructions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(cart, /localStorage/);
  assert.match(cart, /Escape/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /aria-live="polite"/);
  assert.match(checkout, /demo figures/i);
  assert.match(checkout, /DR bank transfer/);
  assert.match(checkout, /Zelle/);
  assert.match(checkout, /Pay in person/);
  assert.match(checkout, /hosted card/i);
  assert.match(checkout, /Demo VAT 20%, included/);
  assert.match(checkout, /startHostedCheckout/);
  assert.match(checkout, /CardPayment/);
  assert.match(checkout, /createOrderId/);
  assert.match(checkout, /buildOrder/);
  assert.match(checkout, /Open pending orders/);
  assert.match(checkout, /Escape/);
  assert.match(layout, /OrderProvider/);
  assert.match(instructions, /AUD-/);
  assert.match(checkout, /usePayeeSettings/);
  const ordersPage = await readFile(new URL("../app/orders/page.tsx", import.meta.url), "utf8");
  const orderRecord = await readFile(new URL("../app/order-record.ts", import.meta.url), "utf8");
  const paymentsPage = await readFile(new URL("../app/payments/page.tsx", import.meta.url), "utf8");
  assert.match(ordersPage, /Mark paid/);
  assert.match(ordersPage, /Mark collected/);
  assert.match(ordersPage, /Owner queue/);
  assert.match(orderRecord, /audiophile-orders-v1/);
  assert.match(orderRecord, /pending_transfer/);
  assert.match(orderRecord, /in_person_collected/);
  assert.match(paymentsPage, /\/orders/);
  assert.match(paymentsPage, /Sample customer view/);
  assert.match(paymentsPage, /Amount from checkout/);
  assert.doesNotMatch(paymentsPage, /AUD-TEST/);
  assert.match(paymentsPage, /aria-live="polite"/);
  assert.match(checkout, /querySelectorAll/);
  // The visible "Copy" starts each button's name, and the row label follows it (BTN5, CPY1).
  assert.match(instructions, /aria-label=\{`\$\{visible\} \$\{label\}`\}/);
  assert.match(instructions, /role="status" aria-live="polite"/);
  assert.doesNotMatch(shell, /href="\/orders"/);
  const zelle = await readFile(new URL("../app/zelle/page.tsx", import.meta.url), "utf8");
  assert.match(zelle, /Pay with Zelle/);
  assert.match(zelle, /ZelleQr/);
  assert.match(instructions, /ZelleQr/);
  assert.match(shell, /\/zelle/);
  assert.doesNotMatch(checkout, /PayPal|Demo e-Money/);
  const methods = await readFile(new URL("../app/payment-methods.ts", import.meta.url), "utf8");
  const payee = await readFile(new URL("../app/payee-settings.ts", import.meta.url), "utf8");
  const zelleQr = await readFile(new URL("../app/zelle-qr.tsx", import.meta.url), "utf8");
  assert.match(methods, /createOrderId/);
  assert.match(methods, /element/);
  assert.doesNotMatch(methods, /PayPal/);
  const webhook = await readFile(new URL("../app/stripe-webhook.ts", import.meta.url), "utf8");
  const totals = await readFile(new URL("../app/checkout-totals.ts", import.meta.url), "utf8");
  assert.match(webhook, /verifyStripeWebhookSignature/);
  assert.match(totals, /VAT_RATE = 0.2;/);
  assert.match(paymentsPage, /persona física/);
  const stripeReturn = await readFile(new URL("../app/checkout/stripe/page.tsx", import.meta.url), "utf8");
  assert.match(stripeReturn, /fetchStripePaymentIntent/);
  assert.match(stripeReturn, /session_id/);
  assert.match(payee, /audiophile-payee-stack-v2/);
  assert.match(payee, /parsePayeeSettings/);
  assert.match(payee, /Banreservas/);
  assert.match(payee, /Banco Popular/);
  assert.match(payee, /Royer Adames/);
  assert.match(zelleQr, /zelle-qr\.png/);
  assert.doesNotMatch(packageJson, /"uqr"/);
  assert.match(shell, /\/payments/);
  assert.match(checkout, /aria-invalid/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("checkout reserves its form while the browser restores its cart", async () => {
  const response = await render("/checkout");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Loading your saved cart/);
  assert.match(html, /id="checkout-form"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<fieldset disabled/);
  assert.doesNotMatch(html, /Your cart is empty/);
});

test("the Sites fallback stays guest-only", async () => {
  const features = await render("/api/store/features");
  assert.deepEqual(await features.json(), { demo: true, durableOrders: false, accounts: "coming_soon" });
  const account = await render("/account");
  assert.equal(account.status, 200);
  const { readdir } = await import("node:fs/promises");
  const directory = new URL("../dist/server/", import.meta.url);
  const files = (await readdir(directory, { recursive: true })).filter((name) => name.endsWith(".js"));
  for (const name of files) {
    const source = await readFile(new URL(name, directory), "utf8");
    assert.doesNotMatch(source, /createFederatedAuth|pg-pool|attachDatabasePool/, `${name} must not bundle the database or accounts`);
  }
});

test("every page says this is a demo store, and checkout offers sample details", async () => {
  for (const pathname of ["/", "/checkout", "/headphones/xx99-mark-two-headphones"]) {
    const html = await (await render(pathname)).text();
    assert.match(html, /Demo store/, `${pathname} shows the demo notice`);
    assert.match(html, /nothing is sold, charged or shipped/i, `${pathname} says nothing is real`);
  }
  const checkout = await (await render("/checkout")).text();
  assert.match(checkout, /Fill sample details/);
  assert.match(checkout, /name, email, phone and address stay in this browser/i, "Checkout says what the server keeps");
});

// Frontend Mentor score, October 10: served HTML must validate (html-validate unique-landmark,
// aria-label-misuse, no-redundant-for, valid-autocomplete) and every block sits in a landmark (axe region).
test("landmarks have unique names and the demo notice sits in one", async () => {
  const html = await (await render("/")).text();
  const navLabels = [...html.matchAll(/<nav\b[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(navLabels.length >= 2);
  assert.equal(new Set(navLabels).size, navLabels.length, `navigation landmarks share a name: ${navLabels.join(", ")}`);
  assert.match(html, /<aside[^>]*aria-label="Demo store notice"[^>]*><p class="demo-banner">/);
});

test("quantity controls are named groups, not labelled divs", async () => {
  const html = await (await render("/headphones/xx99-mark-two-headphones")).text();
  assert.match(html, /XX99 Mark II Headphones quantity/);
  assert.doesNotMatch(html, /<div(?![^>]*\brole=)[^>]*aria-label=/);
});

test("checkout fields use single-line address autocomplete and no redundant label for", async () => {
  const html = await (await render("/checkout")).text();
  assert.match(html, /name="address"/);
  assert.doesNotMatch(html, /autoComplete="street-address"|autocomplete="street-address"/);
  assert.doesNotMatch(html, /<label[^>]*\bfor="[^"]*"[^>]*><span>[^<]*<\/span><input/);
});
