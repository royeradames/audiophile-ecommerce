import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.AUDIOPHILE_URL || 'http://127.0.0.1:4346';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local test server.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
const requests = [];
await mkdir('outputs', { recursive: true });
try {
  // Only the provider redirect is substituted; cart, form, persistence and retry run normally.
  await page.route('**/api/stripe/checkout', async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request.orderId);
    await route.fulfill({ json: { url: `${base}/checkout?canceled=1&order=${encodeURIComponent(request.orderId)}` } });
  });
  await page.goto(`${base}/checkout`);
  await page.getByRole('heading', { name: 'Your cart is empty', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Retry Stripe test payment' }).count(), 0);
  results.push('Ordinary empty checkout retains its browse action.');
  await page.goto(`${base}/headphones/xx99-mark-two-headphones`);
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.goto(`${base}/checkout`);
  for (const [id, value] of Object.entries({ name: 'Demo Test Buyer', email: 'demo@example.invalid', phone: '+1 202 555 0148', address: '123 Fictional Test Street', zip: '00000', city: 'Demo City', country: 'Dominican Republic' })) {
    await page.locator(`#${id}`).fill(value);
  }
  await page.locator('input[name="payment"][value="hosted"]').check();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await page.getByRole('heading', { name: 'Card checkout canceled', exact: true }).waitFor();
  await page.getByText(/is still unpaid/).waitFor();
  const readOrders = () => page.evaluate(() => JSON.parse(localStorage.getItem('audiophile-orders-v1') || '[]'));
  const original = await readOrders();
  assert.equal(original.length, 1);
  assert.equal(original[0].status, 'pending_hosted');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('audiophile-demo-cart-v1'))), []);
  await page.reload();
  await page.getByText(/is still unpaid/).waitFor();
  assert.deepEqual(await readOrders(), original);
  results.push('Canceled hosted flow remains visible after cart clearing and refresh; one pending order survives.');
  for (const width of [400, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `outputs/checkout-cancel-${width}.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'Retry Stripe test payment', exact: true }).click();
  await page.getByRole('heading', { name: `Pay ${original[0].id}`, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open Stripe test Checkout', exact: true }).click();
  await page.getByRole('heading', { name: 'Card checkout canceled', exact: true }).waitFor();
  assert.deepEqual(requests, [original[0].id, original[0].id]);
  assert.deepEqual(await readOrders(), original);
  results.push('Retry uses the same pending order through the customer route, without staff sign-in or duplicate order.');
  for (const status of ['paid', 'cancelled']) {
    const saved = [{ ...original[0], status, settledAt: status === 'paid' ? '2026-10-06T22:00:00.000Z' : null }];
    await page.evaluate((records) => localStorage.setItem('audiophile-orders-v1', JSON.stringify(records)), saved);
    await page.reload();
    await page.getByText(/This return did not change its status/).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Retry Stripe test payment' }).count(), 0);
    assert.deepEqual(await readOrders(), saved);
  }
  results.push('Paid and cancelled records keep their status and have no retry action.');
  await page.goto(`${base}/checkout?canceled=1&order=AUD-MISSING`);
  await page.getByText(/The order is not available in this browser/).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Retry Stripe test payment' }).count(), 0);
  await page.getByRole('link', { name: 'Browse headphones', exact: true }).waitFor();
  results.push('Missing order explains the browser boundary and offers browsing.');
  await page.goto(`${base}/headphones/xx99-mark-two-headphones`);
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.evaluate((records) => localStorage.setItem('audiophile-orders-v1', JSON.stringify(records)), original);
  await page.goto(`${base}/checkout?canceled=1&order=${original[0].id}`);
  await page.getByText(/is still unpaid/).waitFor();
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Retry Stripe test payment', exact: true }).waitFor();
  assert.deepEqual(await readOrders(), original);
  results.push('Existing cart also shows pending-order recovery without losing that cart.');
  assert.deepEqual(errors, []);
  await writeFile('outputs/checkout-cancel-results.json', JSON.stringify({ results, errors, widths: [400, 768, 1280], provider: 'Local redirect substitute; no Stripe API mutation' }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results, errors }, null, 2));
} finally {
  await browser.close();
}
