import { expect, test, type Browser } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { authorizePreviews, payWithTestCard, shopOrigin } from "./hosted-env";

// Fictional buyer. The store keeps only the country, so the suite marks its
// orders with a reserved fictional country that cleanup removes.
const run = Date.now().toString(36) + randomBytes(3).toString("hex");
const buyer = {
  name: "Suite Buyer", email: `suite-${run}@example.test`, phone: "+1 202 555 0148",
  address: "1 Fictional Test Street", zip: "10001", city: "Demo City", country: "Hosted Suite Testland",
};

async function newPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await authorizePreviews(context);
  return context.newPage();
}

test("a guest order is saved before payment, paid once with a Stripe test card, and survives another browser", async ({ browser }) => {
  const page = await newPage(browser);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(shopOrigin + "/headphones/xx99-mark-two-headphones");
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.goto(shopOrigin + "/checkout");
  await expect(page.getByText(/Customer accounts are coming soon|Checking out as a guest/)).toBeVisible();
  for (const [id, value] of Object.entries(buyer)) await page.locator(`#${id}`).fill(value);
  await page.locator('input[name="payment"][value="element"]').check();

  const created = page.waitForResponse((r) => r.url() === shopOrigin + "/api/orders" && r.request().method() === "POST");
  const firstIntent = page.waitForResponse((r) => r.url() === shopOrigin + "/api/stripe/payment-intent" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const { order } = await createdResponse.json();
  expect(order.grandTotal, "Server total: $2,999 + $50 demo shipping + $540 demo ITBIS 18%").toBe(3589);
  await expect(page.getByRole("heading", { name: `Order ${order.id}`, exact: true })).toBeVisible();
  const intentId = String((await (await firstIntent).json()).clientSecret).split("_secret_")[0];
  expect(intentId).toMatch(/^pi_/);

  await test.step("resubmitting the same checkout returns the same order", async () => {
    const replay = await page.request.post(shopOrigin + "/api/orders", {
      data: JSON.parse(createdResponse.request().postData() ?? "{}"),
    });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).order.id).toBe(order.id);
  });

  await test.step("closing the card form and retrying reuses the open PaymentIntent", async () => {
    await page.keyboard.press("Escape");
    const retryIntent = page.waitForResponse((r) => r.url() === shopOrigin + "/api/stripe/payment-intent" && r.request().method() === "POST");
    await page.goto(`${shopOrigin}/checkout/pay?order=${order.id}`);
    const retryId = String((await (await retryIntent).json()).clientSecret).split("_secret_")[0];
    expect(retryId).toBe(intentId);
  });

  await test.step("the test card pays it; a retry records it instead of charging again", async () => {
    await payWithTestCard(intentId);
    // Neither the return page nor a webhook has told the store yet.
    const again = await page.request.post(shopOrigin + "/api/stripe/payment-intent", {
      data: { orderId: order.id, email: buyer.email, items: [{ productId: "xx99-mark-two-headphones", quantity: 1 }] },
    });
    expect(again.status(), "A paid order cannot start another charge").toBe(409);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const confirmed = await page.request.get(`${shopOrigin}/api/stripe/payment-intent?id=${intentId}`);
      expect(confirmed.status()).toBe(200);
      expect((await confirmed.json()).paid).toBe(true);
    }
  });

  await test.step("another browser reads the paid order from its link after a reload", async () => {
    const other = await newPage(browser);
    await other.goto(`${shopOrigin}/checkout/pay?order=${order.id}`);
    const card = other.getByRole("article", { name: order.id });
    await expect(card.getByText("Paid", { exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByRole("article", { name: order.id }).getByText("Paid", { exact: true })).toBeVisible();
    await expect(other.getByText(buyer.address)).toHaveCount(0);
    for (const [width, height] of [[400, 860], [768, 1024], [1440, 900]]) {
      await other.setViewportSize({ width, height });
      expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`).toBe(true);
      await other.screenshot({ path: `test-results-hosted/order-paid-${width}.png`, fullPage: true });
    }
  });

  expect(errors).toEqual([]);
});
