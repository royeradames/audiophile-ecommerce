// Demo-store browser checks against the built app with an in-memory database:
// the notice, sample details, real validation, the test-card hint, what the
// server keeps, and a 320-1600 px width sweep of checkout and the order page.
//
//   npm run build:vercel
//   node --experimental-strip-types tests/demo-store.browser.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { startTestDatabase } from "./support/database.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const port = Number(process.env.AUDIOPHILE_DEMO_PORT || 4566);
const base = `http://127.0.0.1:${port}`;
const widths = [320, 360, 375, 390, 400, 414, 480, 600, 768, 820, 1024, 1280, 1440, 1600];
const out = "outputs/demo-store";
await mkdir(out, { recursive: true });
const results = [];
const errors = [];
const cleanup = [];
const log = (step) => { results.push(step); console.log("✓", step); };

try {
  const database = await startTestDatabase();
  cleanup.push(() => database.close());
  const app = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...process.env, DATABASE_URL: database.url, DATABASE_POOL_MAX: "1", STAFF_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let appLog = "";
  app.stdout.on("data", (chunk) => { appLog += chunk; });
  app.stderr.on("data", (chunk) => { appLog += chunk; });
  cleanup.push(async () => { app.kill("SIGTERM"); await writeFile(`${out}/app.log`, appLog); });
  for (let attempt = 0; ; attempt += 1) {
    if (await fetch(`${base}/api/store/features`).then((r) => r.ok).catch(() => false)) break;
    assert.ok(attempt < 60, "The app did not start");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(base + "/");
  await page.getByText(/Demo store/).first().waitFor();
  await page.getByText(/nothing is sold, charged or shipped/i).first().waitFor();
  log("Every page shows the demo-store notice.");

  await page.goto(base + "/headphones/xx99-mark-two-headphones");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.goto(base + "/checkout");
  const fill = page.getByRole("button", { name: "Fill sample details" });
  assert.equal(await fill.isDisabled(), false);
  await fill.click();
  for (const id of ["name", "email", "phone", "address", "zip", "city", "country"]) {
    assert.notEqual(await page.locator(`#${id}`).inputValue(), "", `${id} was filled`);
  }
  assert.match(await page.locator("#email").inputValue(), /@example\.(test|com)$/);
  log("Fill sample details fills fictional details.");

  // Validation stays real: an emptied field blocks the order and takes focus.
  await page.locator("#phone").fill("");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page.locator("#phone-error").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "phone", "Focus moves to the first error");
  await fill.click();
  log("Validation still runs on sample details, and focus goes to the first error.");

  await page.locator('input[name="payment"][value="element"]').check();
  await page.getByText(/4242 4242 4242 4242/).first().waitFor();
  log("Card payment shows the Stripe test card hint.");
  await page.locator('input[name="payment"][value="transfer"]').check();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Checkout overflows at ${width}`);
    await page.screenshot({ path: `${out}/checkout-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  log(`Checkout has no horizontal overflow from ${widths[0]} to ${widths.at(-1)} px.`);

  const created = page.waitForResponse((r) => r.url() === base + "/api/orders" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  const { order } = await (await created).json();
  await page.getByRole("heading", { name: `Order ${order.id}`, exact: true }).waitFor();
  const stored = await database.query(`select * from "audiophile_orders" where "id" = $1`, [order.id]);
  const row = JSON.stringify(stored.rows[0]);
  for (const id of ["name", "email", "phone", "address", "city"]) {
    const value = await page.evaluate((field) => JSON.parse(localStorage.getItem("audiophile-orders-v1") || "[]")[0]?.customer?.[field], id);
    assert.ok(value && !row.includes(value), `The server row does not keep the ${id}`);
  }
  log("The server keeps the order without name, email, phone or address.");

  await page.goto(`${base}/checkout/pay?order=${order.id}`);
  await page.getByRole("article", { name: order.id }).waitFor();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Order page overflows at ${width}`);
    await page.screenshot({ path: `${out}/order-${width}.png`, fullPage: true });
  }
  log(`The order page has no horizontal overflow from ${widths[0]} to ${widths.at(-1)} px.`);

  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ orderId: order.id, results, errors, widths }, null, 2));
  console.log(JSON.stringify({ passed: results.length, errors }, null, 2));
} finally {
  for (const step of cleanup.reverse()) await Promise.resolve().then(step).catch(() => undefined);
}
