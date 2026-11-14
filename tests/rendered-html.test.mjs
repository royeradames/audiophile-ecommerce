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
  assert.match(html, /simulated checkout/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
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
  const [cart, checkout, shell, css, packageJson] = await Promise.all([
    readFile(new URL("../app/cart-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/checkout/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/site-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(cart, /localStorage/);
  assert.match(cart, /Escape/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /aria-live="polite"/);
  assert.match(checkout, /Nothing is charged or sent/);
  assert.match(checkout, /aria-invalid/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
