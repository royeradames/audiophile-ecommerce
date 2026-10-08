// QA packet of October 8, 2026 (width sweep and journeys), as one regression:
// no horizontal page scroll, no heading that spills out of or squeezes in its
// box, no text under 16 px, the menu journey without overlap, and the site
// identity (og:site_name and WebSite JSON-LD). Runs against a built app.
//
//   npm run build:vercel && next start -H 127.0.0.1 -p 4568
//   AUDIOPHILE_URL=http://127.0.0.1:4568 node tests/layout-identity.browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.AUDIOPHILE_URL || "http://127.0.0.1:4568";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use a local test server.");
const routes = [
  "/", "/headphones", "/speakers", "/earphones",
  "/headphones/xx59-headphones", "/headphones/xx99-mark-one-headphones", "/headphones/xx99-mark-two-headphones",
  "/speakers/zx9-speaker", "/speakers/zx7-speaker", "/earphones/yx1-earphones",
  "/payments", "/zelle", "/checkout", "/orders", "/account",
];
const widths = [320, 330, 350, 400, 630, 650, 670, 770, 910, 920, 960, 1000, 1280, 1920];
const failures = [];

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // A saved cart, so checkout shows its form rather than the empty state.
  await context.addInitScript(() => localStorage.setItem("audiophile-demo-cart-v1",
    JSON.stringify([{ productId: "xx99-mark-two-headphones", quantity: 1 }])));
  const page = await context.newPage();

  for (const route of routes) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(base + route, { waitUntil: "networkidle" });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const found = await page.evaluate(() => {
        const out = [];
        const visible = (el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
          out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px)`);
        }
        for (const el of document.querySelectorAll("body *")) {
          if (el.closest("[data-sweep-allow-small], iframe, svg, script, style")) continue;
          const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
          if (!ownText || !visible(el)) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 15.5) out.push(`${size}px text "${ownText.slice(0, 30)}" <${el.tagName.toLowerCase()} class="${el.className}">`);
        }
        for (const el of document.querySelectorAll("h1, h2, h3")) {
          // Visually hidden headings (1px clip) exist for screen readers only.
          if (!visible(el) || el.clientWidth <= 2) continue;
          if (el.scrollWidth > el.clientWidth + 1) out.push(`heading spills "${el.textContent.trim().slice(0, 30)}" (${el.scrollWidth} > ${el.clientWidth})`);
          const text = el.textContent.trim();
          if (text.split(/\s+/).length < 2) continue;
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
          if (lines > 1 && text.length / lines < 8) out.push(`heading squeezed "${text.slice(0, 30)}" (${(text.length / lines).toFixed(1)} chars per line)`);
        }
        return out;
      });
      for (const problem of new Set(found)) failures.push(`${route} @${width}: ${problem}`);
    }
  }

  // Journey: browse a category from the menu on a phone, with nothing covered.
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(base + "/");
  await page.getByRole("button", { name: "Menu" }).click();
  const overlap = await page.evaluate(() => {
    const nav = document.querySelector("#primary-navigation").getBoundingClientRect();
    const covered = [...document.querySelectorAll("main h1, main p, .demo-banner")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.top < nav.bottom - 2 && box.bottom > nav.top + 2;
    });
    return covered.map((el) => el.textContent.trim().slice(0, 30));
  });
  if (overlap.length) failures.push(`menu covers page text: ${overlap.join(" | ")}`);
  await page.locator("#primary-navigation").getByRole("link", { name: "Speakers" }).click();
  await page.waitForURL(base + "/speakers");

  // Site identity on every route.
  for (const route of routes) {
    await page.goto(base + route);
    const identity = await page.evaluate(() => ({
      siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content"),
      website: [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => {
        try { return [JSON.parse(s.textContent)].flat().some((item) => item["@type"] === "WebSite" && item.name); } catch { return false; }
      }),
    }));
    if (identity.siteName !== "Audiophile") failures.push(`${route}: og:site_name is ${identity.siteName}`);
    if (!identity.website) failures.push(`${route}: no WebSite JSON-LD`);
  }
} finally {
  await browser.close();
}

const unique = [...new Set(failures)];
await mkdir("outputs", { recursive: true });
await writeFile("outputs/layout-findings.txt", unique.join("\n") + "\n");
console.log(unique.length ? unique.slice(0, 80).join("\n") + (unique.length > 80 ? `\n… ${unique.length - 80} more` : "") : "layout and identity: no findings");
console.log(JSON.stringify({ findings: unique.length }));
process.exitCode = unique.length ? 1 : 0;
