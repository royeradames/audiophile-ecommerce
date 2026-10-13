// Frontend Mentor solution report, October 13, 2026: the cart dialog let Tab
// leave it, phone and ZIP accepted any text, and no test rendered the cart or
// checkout UI. Runs against a built app, like layout-identity.browser.mjs.
//
//   AUDIOPHILE_URL=http://127.0.0.1:4568 node tests/cart-checkout-ui.browser.mjs
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.AUDIOPHILE_URL || "http://127.0.0.1:4568";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const failures = [];

// Each section runs on its own page, so one failure does not hide the other.
async function section(name, run) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await run(page);
    console.log("✓ " + name);
  } catch (error) {
    failures.push(name);
    console.error("✗ " + name + ": " + (error?.message ?? error));
  } finally {
    await page.close();
  }
}

// Add to cart opens the cart once React has hydrated; retry until it does.
async function addHeadphones(page) {
  await page.goto(base + "/headphones/xx99-mark-two-headphones");
  const add = page.getByRole("button", { name: "Add to cart", exact: true });
  await add.waitFor();
  const dialog = page.getByRole("dialog", { name: /^Cart/ });
  for (let attempt = 0; attempt < 20 && !(await dialog.isVisible()); attempt += 1) {
    await add.click();
    await page.waitForTimeout(300);
  }
  await dialog.waitFor();
  return dialog;
}

const activeName = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim());

try {
  await section("Loading a page leaves focus where the browser puts it.", async (page) => {
    await page.goto(base + "/headphones");
    await page.getByRole("button", { name: /^Open cart, / }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "nothing takes focus on load");
  });

  await section("The cart dialog keeps Tab inside and returns focus on Escape.", async (page) => {
    const dialog = await addHeadphones(page);
    assert.equal(await activeName(page), "Close", "the cart opens on Close");
    const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")));
    for (let press = 1; press <= 12; press += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await inside(), true, `Tab press ${press} stays in the cart`);
    }
    for (let press = 1; press <= 12; press += 1) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await inside(), true, `Shift+Tab press ${press} stays in the cart`);
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await activeName(page), "Add to cart", "Escape returns focus to Add to cart");
    await page.getByRole("button", { name: /^Open cart, / }).click();
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.match((await activeName(page)) ?? "", /^Open cart/, "Escape returns focus to the Cart button");
    // Removing the focused control keeps focus in the cart.
    await page.keyboard.press("Enter");
    await dialog.waitFor();
    // Press − until the item is gone, so the focused button itself is removed.
    // Scope to the cart: the product page's own − button comes first in the DOM.
    const decrease = dialog.getByRole("button", { name: /^Decrease .* quantity$/ }).first();
    await decrease.focus();
    for (let press = 0; press < 20 && (await page.locator(".cart-list li").count()) > 0; press += 1) {
      await page.keyboard.press("Enter");
    }
    assert.equal(await page.locator(".cart-list li").count(), 0, "the last unit was removed");
    assert.equal(await inside(), true, "focus stays in the cart after − removes the last unit");
    await addHeadphones(page);
    await page.getByRole("button", { name: "Remove all items", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await inside(), true, "focus stays in the cart after Remove all items");
  });

  await section("Checkout refuses a phone or ZIP of plain text and accepts real ones.", async (page) => {
    await addHeadphones(page);
    await page.goto(base + "/checkout");
    const phone = page.locator("#phone");
    const zip = page.locator("#zip");
    const placeOrder = page.getByRole("button", { name: /^Place order/ }).first();
    await placeOrder.waitFor();
    await phone.fill("abc");
    await zip.fill("abc");
    await placeOrder.click();
    await page.getByText("Enter a valid phone number.").first().waitFor({ timeout: 5000 });
    await page.getByText("Enter a valid ZIP code.").first().waitFor({ timeout: 5000 });
    assert.equal(await phone.getAttribute("aria-invalid"), "true");
    await phone.fill("+1 202 555 0148");
    await zip.fill("10001");
    await placeOrder.click();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText("Enter a valid phone number.").count(), 0, "a real phone number clears the error");
    assert.equal(await page.getByText("Enter a valid ZIP code.").count(), 0, "a real ZIP code clears the error");
  });

  assert.deepEqual(failures, [], "every section passes");
} finally {
  await browser.close();
}
