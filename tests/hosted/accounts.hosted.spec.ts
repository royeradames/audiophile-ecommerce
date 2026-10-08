import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { accountsConfigured, accountsOrigin, authorizePreviews, readSink, rememberOrder, shopOrigin } from "./hosted-env";

// Synthetic Breakthrough accounts. Reserved .test recipients go to the
// issuer's preview sink, never to a real inbox. Every address starts with
// "audiophile-suite-" so cleanup can find and remove them.
const run = Date.now().toString(36) + randomBytes(3).toString("hex");
function person(label: string) {
  return {
    name: "Audiophile Suite " + label,
    username: "audsuite" + label + run,
    email: `audiophile-suite-${label}-${run}@sink.accounts-preview.test`,
    password: "A synthetic Audiophile phrase " + randomBytes(6).toString("hex"),
  };
}
type Person = ReturnType<typeof person>;

async function newPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await authorizePreviews(context);
  return context.newPage();
}

async function verificationLink(email: string) {
  let link = "";
  await expect.poll(async () => {
    const response = await readSink(email);
    if (response.status !== 200) return false;
    const { messages } = await response.json() as { messages: Array<{ subject: string; text: string }> };
    const message = messages.find((item) => /verify/i.test(item.subject));
    link = /https:\/\/[^\s"<>]+/.exec(message?.text ?? "")?.[0] ?? "";
    return Boolean(link);
  }, { message: "Waiting for the verification message", timeout: 30_000 }).toBe(true);
  expect(new URL(link).origin, "Mail links stay on the issuer").toBe(accountsOrigin);
  return link;
}

async function createCentralAccount(page: Page, account: Person) {
  await page.goto(accountsOrigin + "/create-account");
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.locator("input").and(page.getByLabel("Password", { exact: true })).fill(account.password);
  // royer-auth #10: every new-password form has a confirmation field.
  await page.getByLabel("Confirm password", { exact: true }).fill(account.password);
  // Live requirements: the long synthetic phrase meets every rule.
  const rules = page.getByRole("list", { name: "Password requirements" });
  await expect(rules.getByRole("listitem").first()).toContainText("met");
  await expect(rules.getByRole("listitem").filter({ hasText: /not met/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await verificationLink(account.email));
  // royer-auth #11: the link lands on a readable "verified" page.
  await expect(page.getByRole("heading", { name: "Your email is verified." })).toBeVisible();
}

/** Starts on Audiophile's account page and signs in on the issuer's own screen. */
async function signIn(page: Page, account: Person) {
  await page.goto(shopOrigin + "/account");
  await page.getByRole("button", { name: "Sign in with Breakthrough", exact: true }).click();
  await expect(page).toHaveURL((url) => url.origin === accountsOrigin && url.pathname === "/login");
  await page.getByLabel("Username or email").fill(account.username);
  await page.locator("input").and(page.getByLabel("Password", { exact: true })).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(shopOrigin + "/account");
  await expect(page.getByText(`Signed in as ${account.name} (${account.email})`)).toBeVisible();
}

test("a Breakthrough account keeps its Audiophile order history across browsers", async ({ browser }) => {
  test.skip(!accountsConfigured, "Audiophile is not yet registered with the accounts preview issuer");
  const owner = person("a");
  const other = person("b");
  const page = await newPage(browser);
  await createCentralAccount(page, owner);
  await signIn(page, owner);
  await expect(page.getByRole("heading", { name: "No orders yet" })).toBeVisible();
  // Regression (Preview, October 8): a signed-in account with no orders got a 503.
  const empty = await page.request.get(shopOrigin + "/api/account/orders");
  expect(empty.status()).toBe(200);
  expect((await empty.json()).orders).toEqual([]);

  await page.goto(shopOrigin + "/headphones/xx99-mark-two-headphones");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.goto(shopOrigin + "/checkout");
  await expect(page.getByText(`Signed in as ${owner.name}. This order will be saved to your account.`)).toBeVisible();
  const details = { name: owner.name, email: owner.email, phone: "+1 202 555 0148", address: "1 Fictional Test Street", zip: "10001", city: "Demo City", country: "United States" };
  for (const [id, value] of Object.entries(details)) await page.locator(`#${id}`).fill(value);
  await page.locator('input[name="payment"][value="transfer"]').check();
  const created = page.waitForResponse((r) => r.url() === shopOrigin + "/api/orders" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  const { order } = await (await created).json();
  rememberOrder(order.id);
  expect(order.savedToAccount).toBe(true);
  await expect(page.getByText("Saved to your account. Find it under Account in any browser.")).toBeVisible();

  await test.step("a second browser signed in to the same account sees the order", async () => {
    const second = await newPage(browser);
    await signIn(second, owner);
    await expect(second.getByRole("article", { name: order.id })).toBeVisible();
    for (const [width, height] of [[400, 860], [768, 1024], [1440, 900]]) {
      await second.setViewportSize({ width, height });
      expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`).toBe(true);
      await second.screenshot({ path: `test-results-hosted/account-history-${width}.png`, fullPage: true });
    }
  });

  await test.step("another account cannot see it", async () => {
    const stranger = await newPage(browser);
    await createCentralAccount(stranger, other);
    await signIn(stranger, other);
    await expect(stranger.getByRole("heading", { name: "No orders yet" })).toBeVisible();
    expect((await (await stranger.request.get(shopOrigin + "/api/account/orders")).json()).orders).toEqual([]);
  });

  await test.step("signing out of Audiophile keeps the Breakthrough account signed in", async () => {
    await page.goto(shopOrigin + "/account");
    await page.getByRole("button", { name: "Sign out of Audiophile" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to see your order history" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in with Breakthrough", exact: true }).click();
    await expect(page).toHaveURL(shopOrigin + "/account");
    await expect(page.getByRole("article", { name: order.id })).toBeVisible();
  });
});
