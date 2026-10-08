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
const widths = [320, 330, 350, 400, 620, 621, 630, 650, 670, 770, 900, 901, 910, 920, 960, 1000, 1110, 1280, 1920];
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
          // A word split across lines, or more lines than words, is a squeeze.
          const words = [];
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            for (const match of node.textContent.matchAll(/\S+/g)) {
              const range = document.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
              words.push(match[0]);
              if (tops.size > 1) out.push(`heading breaks a word "${match[0]}" in "${el.textContent.trim().slice(0, 30)}"`);
            }
          }
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
          if (lines > words.length) out.push(`heading squeezed "${el.textContent.trim().slice(0, 30)}" (${lines} lines for ${words.length} words)`);
        }
        // The header: wordmark, nav and cart never touch, and the desktop nav is one line.
        const parts = [".wordmark", "#primary-navigation", ".cart-button", ".menu-button"]
          .map((selector) => document.querySelector(`header ${selector}`))
          .filter((el) => el && visible(el));
        for (let a = 0; a < parts.length; a += 1) {
          for (let b = a + 1; b < parts.length; b += 1) {
            const one = parts[a].getBoundingClientRect(), two = parts[b].getBoundingClientRect();
            if (one.left < two.right - 1 && two.left < one.right - 1 && one.top < two.bottom - 1 && two.top < one.bottom - 1) {
              out.push(`header crowded: ${parts[a].className || parts[a].id} meets ${parts[b].className || parts[b].id}`);
            }
          }
        }
        const nav = document.querySelector("#primary-navigation");
        if (innerWidth > 900 && nav && visible(nav)) {
          const tops = new Set([...nav.querySelectorAll("a")].map((a) => Math.round(a.getBoundingClientRect().top)));
          if (tops.size > 1) out.push(`desktop nav wraps to ${tops.size} lines`);
        }
        return out;
      });
      for (const problem of new Set(found)) failures.push(`${route} @${width}: ${problem}`);
    }
  }

  // Journey: browse a category from the menu on a phone and a tablet, with
  // nothing covered and the bar keeping its height.
  for (const width of [320, 400, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(base + "/");
    const menu = page.getByRole("button", { name: "Menu" });
    const barBefore = await page.evaluate(() => document.querySelector(".wordmark").getBoundingClientRect().top);
    await menu.click();
    if (await page.locator(".menu-button").getAttribute("aria-expanded") !== "true") failures.push(`menu @${width}: aria-expanded is not true`);
    const state = await page.evaluate(() => {
      const nav = document.querySelector("#primary-navigation").getBoundingClientRect();
      const covered = [...document.querySelectorAll("main h1, main p, .demo-banner")].filter((el) => {
        const box = el.getBoundingClientRect();
        return box.height > 0 && box.top < nav.bottom - 2 && box.bottom > nav.top + 2;
      });
      return { covered: covered.map((el) => el.textContent.trim().slice(0, 30)), bar: document.querySelector(".wordmark").getBoundingClientRect().top };
    });
    if (state.covered.length) failures.push(`menu @${width} covers page text: ${state.covered.join(" | ")}`);
    if (Math.abs(state.bar - barBefore) > 1) failures.push(`menu @${width}: header bar moved ${state.bar - barBefore}px`);
    await page.getByRole("button", { name: "Close" }).click();
    if (await page.locator("#primary-navigation").isVisible()) failures.push(`menu @${width}: Close left the menu open`);
    await menu.click();
    await page.locator("#primary-navigation").getByRole("link", { name: "Speakers" }).click();
    await page.waitForURL(base + "/speakers");
  }

  // The cart dialog on the narrowest phone: heading and Close side by side, no overlap.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(base + "/");
  await page.locator(".cart-button").click();
  const cart = await page.evaluate(() => {
    const out = [];
    const panel = document.querySelector(".cart-panel");
    if (panel.scrollWidth > panel.clientWidth + 1) out.push("cart panel spills");
    const [title, close] = [panel.querySelector(".cart-heading > div"), panel.querySelector(".cart-heading button")].map((el) => el.getBoundingClientRect());
    if (title.left < close.right - 1 && close.left < title.right - 1 && title.top < close.bottom - 1 && close.top < title.bottom - 1) out.push("cart heading meets Close");
    for (const el of panel.querySelectorAll("*")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 15.5) out.push(`cart text under 16 px: ${el.textContent.trim().slice(0, 20)}`);
    }
    return out;
  });
  failures.push(...cart.map((problem) => `cart dialog @320: ${problem}`));

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
