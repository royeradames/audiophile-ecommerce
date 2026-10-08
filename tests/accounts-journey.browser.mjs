// Real-browser journey for durable orders and customer accounts, entirely on
// this machine: the reviewed @royer/auth issuer and the built Audiophile app
// run over HTTPS on *.localhost names with in-memory PostgreSQL, synthetic
// accounts and Stripe's published test card.
//
//   npm run build:vercel
//   node --experimental-strip-types tests/accounts-journey.browser.mjs
//
// Needs Stripe test keys in .env.local (Next loads them). Ports come from
// AUDIOPHILE_JOURNEY_PORT (default 4561; uses it and the next three).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { startTestDatabase } from "./support/database.ts";
import { localCertificates, startLocalIssuer } from "./support/local-issuer.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = Number(process.env.AUDIOPHILE_JOURNEY_PORT || 4561);
const ports = { app: base, shop: base + 2, issuer: base + 3 };
const SHOP = `https://shop.localhost:${ports.shop}`;
const ISSUER = `https://accounts.localhost:${ports.issuer}`;
const card = { number: "4242424242424242", expiry: "12 / 34", cvc: "123", postal: "10001" };
const people = {
  alice: { name: "Alice Example", email: "alice@example.test", password: randomBytes(18).toString("base64url") },
  bob: { name: "Bob Example", email: "bob@example.test", password: randomBytes(18).toString("base64url") },
};
const buyer = { name: "Alice Example", email: people.alice.email, phone: "+1 202 555 0148", address: "1 Fictional Test Street", zip: "10001", city: "Demo City", country: "United States" };

await mkdir("outputs/accounts-journey", { recursive: true });
const results = [];
const errors = [];
const cleanup = [];
const pages = [];

function log(step) {
  results.push(step);
  console.log("✓", step);
}

try {
  const tls = await localCertificates(["shop.localhost", "accounts.localhost"]);
  const issuer = await startLocalIssuer({
    origin: ISSUER,
    tls,
    clients: [{ name: "Audiophile (local test)", callbackURL: `${SHOP}/api/auth/federation/callback`, logoutURL: `${SHOP}/account` }],
  });
  cleanup.push(() => issuer.close());
  for (const person of Object.values(people)) await issuer.createAccount(person);
  log("Local issuer registered Audiophile and verified two synthetic accounts.");

  const database = await startTestDatabase();
  cleanup.push(() => database.close());
  const [client] = issuer.credentials;
  const app = spawn("node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", String(ports.app)], {
    env: {
      ...process.env,
      DATABASE_URL: database.url,
      DATABASE_POOL_MAX: "1",
      AUTH_BASE_URL: SHOP,
      AUTH_SECRET: randomBytes(32).toString("base64url"),
      AUTH_ISSUER_URL: issuer.issuerURL,
      AUTH_CLIENT_ID: client.clientId,
      AUTH_CLIENT_SECRET: client.clientSecret,
      NODE_EXTRA_CA_CERTS: tls.caPath,
      STAFF_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let appLog = "";
  app.stdout.on("data", (chunk) => { appLog += chunk; });
  app.stderr.on("data", (chunk) => { appLog += chunk; });
  cleanup.push(async () => {
    app.kill("SIGTERM");
    await writeFile("outputs/accounts-journey/app.log", appLog);
  });

  // HTTPS front door for the app, like Vercel's edge: same host, forwarded proto.
  const proxy = createServer(tls, (incoming, outgoing) => {
    const upstream = httpRequest({
      host: "127.0.0.1", port: ports.app, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, "x-forwarded-proto": "https", "x-forwarded-host": incoming.headers.host },
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  await new Promise((resolve) => proxy.listen(ports.shop, "::", resolve));
  cleanup.push(() => new Promise((resolve) => { proxy.close(resolve); proxy.closeAllConnections(); }));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await fetch(`http://127.0.0.1:${ports.app}/api/store/features`).then((r) => r.ok).catch(() => false);
    if (ready) break;
    assert.ok(attempt < 59, "The app did not start");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const features = await (await fetch(`http://127.0.0.1:${ports.app}/api/store/features`)).json();
  assert.deepEqual(features, { durableOrders: true, accounts: "enabled" });
  if (process.env.JOURNEY_PROBE) {
    const probe = await new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: ports.app, method: "POST", path: "/api/auth/federation/start",
        headers: { host: new URL(SHOP).host, origin: SHOP, "x-forwarded-proto": "https", "content-type": "application/json" } },
      (res) => { let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, body: body.slice(0, 300) })); });
      req.on("error", reject); req.end(JSON.stringify({ returnPath: "/account" }));
    });
    console.log("probe", probe.status, probe.body.replace(/https?:\/\/\S+/g, "[url]"));
    throw new Error("probe only");
  }

  const launch = () => chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const browsers = { first: await launch(), second: await launch() };
  cleanup.push(() => browsers.first.close(), () => browsers.second.close());

  async function open(browser, label) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    pages.push({ label, page });
    return { context, page };
  }

  /** Signs in on the issuer (the accounts site), then continues into Audiophile. */
  async function signIn({ context, page }, person) {
    const response = await context.request.post(`${ISSUER}/api/auth/sign-in/email`, {
      data: { email: person.email, password: person.password }, headers: { origin: ISSUER },
    });
    assert.equal(response.status(), 200, "Issuer sign-in");
    await page.goto(`${SHOP}/account`);
    await page.getByRole("button", { name: "Sign in with Breakthrough", exact: true }).click();
    await page.waitForURL(`${SHOP}/account`);
    await page.getByText(`Signed in as ${person.name} (${person.email})`).waitFor();
  }

  async function noOverflow(page, name) {
    for (const width of [400, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflows at ${width}`);
      await page.screenshot({ path: `outputs/accounts-journey/${name}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // 1. Alice signs in, buys with the Stripe test card, and the order is saved.
  const alice = await open(browsers.first, "first browser");
  await alice.page.goto(`${SHOP}/account`);
  await alice.page.getByRole("heading", { name: "Sign in to see your order history" }).waitFor();
  await noOverflow(alice.page, "account-signed-out");
  await signIn(alice, people.alice);
  await alice.page.getByRole("heading", { name: "No orders yet" }).waitFor();
  log("First browser signed in through the issuer; history starts empty.");

  await alice.page.goto(`${SHOP}/headphones/xx99-mark-two-headphones`);
  await alice.page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await alice.page.goto(`${SHOP}/checkout`);
  await alice.page.getByText(`Signed in as ${people.alice.name}. This order will be saved to your account.`).waitFor();
  await noOverflow(alice.page, "checkout-signed-in");
  for (const [id, value] of Object.entries(buyer)) await alice.page.locator(`#${id}`).fill(value);
  await alice.page.locator('input[name="payment"][value="element"]').check();
  await alice.page.getByRole("button", { name: "Place order", exact: true }).click();
  const heading = alice.page.getByRole("heading", { name: /^Order AUD-[0-9A-Z]{10}$/ });
  await heading.waitFor();
  const orderId = (await heading.textContent()).replace("Order ", "").trim();
  await alice.page.getByText("Saved to your account. Find it under Account in any browser.").waitFor();

  const stripe = alice.page.frameLocator('iframe[title="Secure payment input frame"]').first();
  await stripe.locator('[name="number"]').fill(card.number, { timeout: 60_000 });
  await stripe.locator('[name="expiry"]').fill(card.expiry);
  await stripe.locator('[name="cvc"]').fill(card.cvc);
  const country = stripe.locator('select[name="country"]');
  if (await country.count()) await country.selectOption("US");
  const postal = stripe.locator('[name="postalCode"]');
  if (await postal.count()) await postal.fill(card.postal);
  await alice.page.getByRole("button", { name: "Pay $3,589 (Stripe test)" }).click();
  await alice.page.getByText("Stripe test payment recorded. This is not a live merchant charge.").waitFor({ timeout: 60_000 });
  log(`Order ${orderId} was created on the server and paid with Stripe's test card.`);

  await alice.page.goto(`${SHOP}/account`);
  const aliceCard = alice.page.getByRole("article", { name: orderId });
  await aliceCard.getByText("Paid", { exact: true }).waitFor();
  await alice.page.reload();
  await alice.page.getByRole("article", { name: orderId }).getByText("Paid", { exact: true }).waitFor();
  await noOverflow(alice.page, "account-history");
  log("The paid order is in Alice's history and survives a reload.");

  // 2. A different browser: the receipt link works as a guest, then the same
  //    account sees the same paid order.
  const second = await open(browsers.second, "second browser");
  await second.page.goto(`${SHOP}/checkout/pay?order=${orderId}`);
  await second.page.getByRole("heading", { name: `Order ${orderId}`, exact: true }).waitFor();
  await second.page.getByRole("article", { name: orderId }).getByText("Paid", { exact: true }).waitFor();
  assert.equal(await second.page.getByText(buyer.address).count(), 0, "The receipt page hides the shipping address");
  await noOverflow(second.page, "order-receipt");
  await signIn(second, people.alice);
  await second.page.getByRole("article", { name: orderId }).getByText("Paid", { exact: true }).waitFor();
  log("A second browser sees the paid order by its link and in the same account's history.");

  // 3. Another account cannot see Alice's order.
  const bob = await open(browsers.second, "third context");
  await signIn(bob, people.bob);
  await bob.page.getByRole("heading", { name: "No orders yet" }).waitFor();
  const bobHistory = await bob.page.request.get(`${SHOP}/api/account/orders`);
  assert.deepEqual((await bobHistory.json()).orders, []);
  log("Bob's history is empty; Alice's order stays hers.");

  // 4. Signing out of Audiophile in one browser leaves the other signed in.
  await alice.page.getByRole("button", { name: "Sign out of Audiophile" }).click();
  await alice.page.getByRole("heading", { name: "Sign in to see your order history" }).waitFor();
  await alice.page.reload();
  await alice.page.getByRole("heading", { name: "Sign in to see your order history" }).waitFor();
  await second.page.reload();
  await second.page.getByRole("article", { name: orderId }).waitFor();
  log("Signing out in the first browser kept the second browser signed in.");

  assert.deepEqual(errors, []);
  await writeFile("outputs/accounts-journey/results.json", JSON.stringify({ orderId, results, errors, widths: [400, 768, 1440] }, null, 2));
  console.log(JSON.stringify({ passed: results.length, orderId, errors }, null, 2));
} catch (error) {
  // Diagnostics: where each page stopped. No cookies, tokens or request bodies.
  for (const [index, { label, page }] of pages.entries()) {
    const url = new URL(page.url());
    console.error(`${label} stopped at ${url.origin}${url.pathname}`);
    console.error((await page.locator("main").innerText().catch(() => "")).slice(0, 600));
    await page.screenshot({ path: `outputs/accounts-journey/failure-${index}.png`, fullPage: true }).catch(() => undefined);
  }
  throw error;
} finally {
  for (const step of cleanup.reverse()) await Promise.resolve().then(step).catch(() => undefined);
}
