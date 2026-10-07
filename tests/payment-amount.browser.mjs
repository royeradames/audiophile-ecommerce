import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.AUDIOPHILE_URL || 'http://127.0.0.1:4347';
const hostname = new URL(base).hostname;
assert(['localhost', '127.0.0.1'].includes(hostname) || (hostname.startsWith('audiophile-') && hostname.endsWith('.vercel.app')), 'Use a local server or this app’s preview.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 900 } });
if (process.env.VERCEL_OIDC_TOKEN) {
  await context.route('**/*', (route) => route.continue({
    headers: new URL(route.request().url()).origin === new URL(base).origin
      ? { ...route.request().headers(), 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN }
      : route.request().headers(),
  }));
}
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
const requests = [];
const productItems = [{ productId: 'xx99-mark-two-headphones', quantity: 1 }];
let checkoutAttempts = 0;
try {
  // Substitute only the external payment surfaces. Never submit a card or contact Stripe.
  await context.addInitScript(() => {
    const noop = () => {};
    window.paymentElementOptions = [];
    window.Stripe = () => ({
      _registerWrapper: noop, registerAppInfo: noop,
      createToken: noop, createPaymentMethod: noop, confirmCardPayment: noop,
      confirmPayment: () => { throw new Error('This UI regression must never submit payment.'); },
      elements: () => ({ update: noop, getElement: () => null, create: (type, options) => {
        if (type === 'payment') window.paymentElementOptions.push(options);
        return {
          on: noop, off: noop, update: noop, destroy: noop,
          mount: (node) => { node.textContent = 'Isolated test payment fields'; },
        };
      } }),
    });
  });
  await context.route('https://*.stripe.com/**', (route) => route.abort());
  await page.route('**/api/stripe/config', (route) => route.fulfill({ json: {
    configured: true, blocked: null, publishableKey: 'pk_test_synthetic_not_a_real_key',
  } }));
  await page.route('**/api/stripe/checkout', async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ path: 'checkout', body });
    checkoutAttempts += 1;
    if (checkoutAttempts === 1) {
      await route.fulfill({ status: 502, json: { error: 'Synthetic temporary payment outage. Please retry.' } });
      return;
    }
    await route.fulfill({ json: { url: `${base}/checkout?canceled=1&order=${encodeURIComponent(body.orderId)}` } });
  });
  await page.route('**/api/stripe/payment-intent', async (route) => {
    requests.push({ path: 'payment-intent', body: route.request().postDataJSON() });
    await route.fulfill({ json: { clientSecret: 'pi_synthetic_secret_fixture', amount: 3589 } });
  });
  async function fillCheckout(payment) {
    await page.goto(`${base}/headphones/xx99-mark-two-headphones`);
    await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await page.goto(`${base}/checkout`);
    for (const [id, value] of Object.entries({ name: 'Synthetic Buyer', email: 'synthetic@example.invalid', phone: '+1 202 555 0148', address: '123 Fictional Test Street', zip: '00000', city: 'Demo City', country: 'Dominican Republic' })) {
      await page.locator(`#${id}`).fill(value);
    }
    await page.locator(`input[name="payment"][value="${payment}"]`).check();
    await page.getByRole('button', { name: /^Place order/ }).click();
  }
  await fillCheckout('hosted');
  await page.getByRole('button', { name: 'Retry Stripe test Checkout', exact: true }).click();
  await page.getByRole('heading', { name: 'Card checkout canceled', exact: true }).waitFor();
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('audiophile-orders-v1')));
  assert.equal(original.length, 1);
  assert.equal(original[0].status, 'pending_hosted');
  assert.equal(requests[0].body.orderId, requests[1].body.orderId);
  results.push('Initial hosted checkout and confirmation retry retain product quantities and the same pending order.');

  // Deliberately corrupt browser-owned money and labels; the wire contract discards them.
  const forged = [{ ...original[0], grandTotal: 1, subtotal: 1, shipping: 0, vat: 0,
    lines: original[0].lines.map((line) => ({ ...line, name: 'Forged label', unitPrice: 1 })) }];
  await page.evaluate((orders) => localStorage.setItem('audiophile-orders-v1', JSON.stringify(orders)), forged);
  await page.reload();
  await page.getByRole('link', { name: 'Retry Stripe test payment', exact: true }).click();
  await page.getByRole('button', { name: 'Open Stripe test Checkout', exact: true }).click();
  await page.getByRole('heading', { name: 'Card checkout canceled', exact: true }).waitFor();
  results.push('Saved hosted retry discards forged browser prices, total, and description.');

  await fillCheckout('element');
  await page.getByRole('button', { name: 'Pay $3,589 (Stripe test)', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.paymentElementOptions.at(-1)?.defaultValues?.billingDetails?.email), 'synthetic@example.invalid');
  results.push('Initial own-card form sends products, displays the server-returned total and passes the known email to Stripe.');
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('audiophile-orders-v1')));
  const cardOrder = records.find((order) => order.payment === 'element');
  assert(cardOrder);
  const forgedCard = { ...cardOrder, grandTotal: 1, lines: cardOrder.lines.map((line) => ({ ...line, unitPrice: 1 })) };
  await page.evaluate((order) => localStorage.setItem('audiophile-orders-v1', JSON.stringify([order])), forgedCard);
  await page.goto(`${base}/checkout/pay?order=${encodeURIComponent(cardOrder.id)}`);
  await page.getByRole('button', { name: 'Pay $3,589 (Stripe test)', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.paymentElementOptions.at(-1)?.defaultValues?.billingDetails?.email), 'synthetic@example.invalid');
  assert.equal(await page.getByRole('button', { name: 'Pay $1 (Stripe test)', exact: true }).count(), 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('audiophile-orders-v1')));
  assert.deepEqual(saved, [forgedCard]);
  results.push('Own-card retry uses server amount despite a forged saved total; it does not claim payment or change the saved order.');
  for (const { body } of requests) {
    assert.deepEqual(Object.keys(body).sort(), ['email', 'items', 'orderId']);
    assert.deepEqual(body.items, productItems);
    assert.equal(body.email, 'synthetic@example.invalid');
  }
  for (const width of [400, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  await mkdir('outputs', { recursive: true });
  await writeFile('outputs/payment-amount-browser-results.json', JSON.stringify({ results, errors, requestCount: requests.length, widths: [400, 768, 1280], provider: 'Isolated payment API and Stripe.js substitutes; no real Stripe request or card submission.' }, null, 2));
  await page.screenshot({ path: 'outputs/payment-amount-card-retry.png', fullPage: true });
  console.log(JSON.stringify({ passed: results.length, errors, requestCount: requests.length }));
} finally {
  await browser.close();
}
