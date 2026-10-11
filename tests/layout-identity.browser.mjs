// QA packet of October 8, 2026 (width sweep and journeys), as one regression:
// no horizontal page scroll, no heading that spills out of or squeezes in its
// box, no text under 16 px, the menu journey without overlap, and the site
// identity (og:site_name and WebSite JSON-LD). Runs against a built app.
//
//   npm run build:vercel && next start -H 127.0.0.1 -p 4568
//   AUDIOPHILE_URL=http://127.0.0.1:4568 node tests/layout-identity.browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

// Minimal PNG reader (8-bit RGB or RGBA, no interlace), enough for Playwright screenshots.
function readPng(buffer) {
  let offset = 8, width = 0, height = 0, channels = 4;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); channels = body[9] === 2 ? 3 : 4; }
    if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter];
      pixels[y * stride + x] = (value + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.AUDIOPHILE_URL || "http://127.0.0.1:4568";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use a local test server.");
const routes = [
  "/", "/headphones", "/speakers", "/earphones",
  "/headphones/xx59-headphones", "/headphones/xx99-mark-one-headphones", "/headphones/xx99-mark-two-headphones",
  "/speakers/zx9-speaker", "/speakers/zx7-speaker", "/earphones/yx1-earphones",
  "/payments", "/zelle", "/checkout", "/orders", "/account",
];
const widths = [320, 330, 350, 400, 620, 621, 630, 640, 650, 660, 670, 770, 900, 901, 910, 920, 940, 960, 1000, 1110, 1280, 1920];
const failures = [];

// Tab from the element that has focus through the header, and report any stop that
// comes before the previous one in reading order (rows by vertical centre, then left to right).
async function headerTabOrder(page) {
  const seen = [];
  for (let i = 0; i < 14; i += 1) {
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest("header")) return null;
      const box = el.getBoundingClientRect();
      return { name: el.textContent.trim().slice(0, 20), centre: box.top + box.height / 2, left: box.left };
    });
    if (!stop) break;
    seen.push(stop);
    await page.keyboard.press("Tab");
  }
  const problems = [];
  if (seen.length < 3) problems.push(`only ${seen.length} header stops reachable by Tab`);
  for (let i = 1; i < seen.length; i += 1) {
    const [a, b] = [seen[i - 1], seen[i]];
    const sameRow = Math.abs(a.centre - b.centre) < 20;
    if (sameRow ? b.left < a.left : b.centre < a.centre) problems.push(`Tab reaches "${b.name}" after "${a.name}", which is below or right of it`);
  }
  return problems;
}

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
        // Labels and buttons keep at least 8 characters per line (squeezed cards).
        for (const el of document.querySelectorAll("main strong, main a.button, main button, main h1, main h2, main h3")) {
          if (!visible(el) || el.clientWidth <= 2 || el.querySelector("br")) continue;
          const text = el.textContent.trim().replace(/\s+/g, " ");
          if (text.split(" ").length < 2) continue;
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
          if (lines > 1 && text.length / lines < 8) out.push(`squeezed "${text.slice(0, 30)}" (${lines} lines)`);
        }
        // Button and link labels stay inside their button.
        for (const el of document.querySelectorAll("a.button, button")) {
          if (visible(el) && el.scrollWidth > el.clientWidth + 1) out.push(`label spills its button "${el.textContent.trim().slice(0, 24)}"`);
        }
        // Fields, bank cards, payment rows and the menu stay inside their box.
        for (const el of document.querySelectorAll(".form-field, .stack-bank, .instruction-list li > *, .recommendation-grid .button, #primary-navigation")) {
          const parent = el.parentElement;
          if (!visible(el) || !parent) continue;
          const box = el.getBoundingClientRect(), outer = parent.getBoundingClientRect();
          const style = getComputedStyle(parent);
          const left = outer.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
          const right = outer.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
          if (box.left < left - 1 || box.right > right + 1) out.push(`spills its box: ${el.className || el.id} "${el.textContent.trim().slice(0, 24)}"`);
        }
        // The header: wordmark, nav and cart never touch, and the desktop nav is one line.
        const parts = [".wordmark", ".desktop-nav", ".cart-button", ".menu-button"]
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
        const nav = document.querySelector(".desktop-nav");
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
      // Hit-test the top edge too, so a positioned or painted overlay is caught as well.
      for (const el of document.querySelectorAll(".demo-banner, main h1")) {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 3);
        if (box.top >= 0 && box.top < innerHeight && hit && !el.contains(hit)) covered.push(el);
      }
      const inner = document.querySelector(".header-inner").getBoundingClientRect();
      return {
        covered: covered.map((el) => el.textContent.trim().slice(0, 30)),
        bar: document.querySelector(".wordmark").getBoundingClientRect().top,
        spills: nav.left < inner.left - 1 || nav.right > inner.right + 1,
        pageScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    if (state.spills) failures.push(`menu @${width}: open menu spills out of the header box`);
    if (state.pageScroll) failures.push(`menu @${width}: open menu scrolls the page sideways`);
    // Paint check: the banner's first line must show the banner's own colour (a menu
    // band painted by a shadow or overlay is invisible to layout and hit tests).
    const banner = await page.locator(".demo-banner").boundingBox();
    if (banner) {
      const shot = readPng(await page.screenshot({ clip: { x: banner.x, y: banner.y + 2, width: banner.width, height: 6 } }));
      const background = await page.evaluate(() => getComputedStyle(document.querySelector(".demo-banner")).backgroundColor.match(/\d+/g).map(Number));
      let own = 0;
      for (let i = 0; i < shot.pixels.length; i += shot.channels) {
        const distance = Math.abs(shot.pixels[i] - background[0]) + Math.abs(shot.pixels[i + 1] - background[1]) + Math.abs(shot.pixels[i + 2] - background[2]);
        if (distance < 60) own += 1;
      }
      if (own / (shot.pixels.length / shot.channels) < 0.5) failures.push(`menu @${width}: the open menu paints over the demo banner`);
    }
    if (state.covered.length) failures.push(`menu @${width} covers page text: ${state.covered.join(" | ")}`);
    if (Math.abs(state.bar - barBefore) > 1) failures.push(`menu @${width}: header bar moved ${state.bar - barBefore}px`);
    // Phone tab order with the menu open: Close, wordmark, Cart, then the links.
    await page.locator(".menu-button").focus();
    for (const problem of await headerTabOrder(page)) failures.push(`menu @${width}: ${problem}`);
    // Escape closes the menu and returns focus to its button.
    await page.keyboard.press("Escape");
    if (await page.locator("#primary-navigation").isVisible()) failures.push(`menu @${width}: Escape left the menu open`);
    if (!(await page.evaluate(() => document.activeElement?.classList.contains("menu-button")))) failures.push(`menu @${width}: Escape did not return focus to the menu button`);
    if (await page.locator("#primary-navigation").isVisible()) await page.locator(".menu-button").click();
    await menu.click();
    // With the menu open, the cart dialog owns Escape: it closes, the menu stays.
    await page.locator(".cart-button").click();
    await page.keyboard.press("Escape");
    if (await page.locator(".cart-panel").isVisible()) failures.push(`menu @${width}: Escape left the cart open`);
    if (!(await page.locator("#primary-navigation").isVisible())) {
      failures.push(`menu @${width}: Escape in the cart also closed the menu`);
      await menu.click();
    }
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

  // The open menu closes when the window widens past 900 px, so it never reopens by itself.
  await page.setViewportSize({ width: 768, height: 800 });
  await page.goto(base + "/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(150);
  await page.setViewportSize({ width: 768, height: 800 });
  await page.waitForTimeout(150);
  if (await page.locator("#primary-navigation").isVisible()) failures.push("menu: reopened after the window widened past 900 px and narrowed again");

  // Desktop tab order: wordmark, the links left to right, then Cart.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + "/");
  await page.locator("header .wordmark").focus();
  for (const problem of await headerTabOrder(page)) failures.push(`desktop header @1280: ${problem}`);

  // The home hero copy sits where the Figma Mobile - Home and Tablet - Home frames put it:
  // the top of each text within 12 px, measured on the page like the design audit does.
  const heroDesign = {
    375: { ".hero .overline": 198, ".hero h1": 233, ".hero-description": 337, ".hero .button": 455 },
    768: { ".hero .overline": 216, ".hero h1": 259, ".hero-description": 399, ".hero .button": 529 },
  };
  for (const [width, expected] of Object.entries(heroDesign)) {
    await page.setViewportSize({ width: Number(width), height: 1400 });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const tops = await page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const range = document.createRange();
      range.selectNodeContents(element);
      return [selector, Math.round(range.getBoundingClientRect().top + scrollY)];
    })), Object.keys(expected));
    for (const [selector, top] of Object.entries(expected)) {
      if (tops[selector] === null) failures.push(`home hero @${width}: ${selector} is missing`);
      else if (Math.abs(tops[selector] - top) > 12) failures.push(`home hero @${width}: ${selector} text starts at ${tops[selector]}px, design ${top}px`);
    }
  }

  const homeCard = {};
  // Transactional and owner pages stay out of search and have no card of their own.
  const privateRoutes = new Set(["/payments", "/zelle", "/checkout", "/orders", "/account"]);
  // Site identity on every route.
  for (const route of routes) {
    await page.goto(base + route);
    const identity = await page.evaluate(() => ({
      siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content"),
      website: [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => {
        try {
          return [JSON.parse(s.textContent)].flat().some((item) => item["@type"] === "WebSite" && item.name === "Audiophile" && item.url === "https://audiophile.royeradames.com/");
        } catch { return false; }
      }),
      ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content"),
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute("content"),
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    }));
    if (identity.siteName !== "Audiophile") failures.push(`${route}: og:site_name is ${identity.siteName}`);
    if (!identity.website) failures.push(`${route}: no WebSite JSON-LD with the canonical name and URL`);
    if (privateRoutes.has(route)) {
      if (!/noindex/.test(identity.robots)) failures.push(`${route}: private page is not noindex`);
      if (identity.canonical || identity.ogUrl) failures.push(`${route}: private page declares a canonical or og:url`);
      continue;
    }
    if (/noindex/.test(identity.robots)) failures.push(`${route}: public page is noindex`);
    if (identity.canonical?.replace(/\/$/, "") !== ("https://audiophile.royeradames.com" + route).replace(/\/$/, "")) failures.push(`${route}: canonical is ${identity.canonical}`);
    // Every public page shares its own card: its own og:url, title and description (LND1, S1).
    const expectedUrl = ("https://audiophile.royeradames.com" + route).replace(/\/$/, "");
    if ((identity.ogUrl || "").replace(/\/$/, "") !== expectedUrl) failures.push(`${route}: og:url is ${identity.ogUrl}, expected ${expectedUrl}`);
    if (!identity.ogImage?.startsWith("https://audiophile.royeradames.com/")) failures.push(`${route}: og:image is ${identity.ogImage}`);
    if (!identity.ogTitle || !identity.ogDescription) failures.push(`${route}: share card lacks a title or description`);
    if (route === "/") Object.assign(homeCard, { title: identity.ogTitle, description: identity.ogDescription });
    if (route !== "/" && identity.ogTitle === homeCard.title) failures.push(`${route}: share card reuses the home title`);
    if (route !== "/" && identity.ogDescription === homeCard.description) failures.push(`${route}: share card reuses the home description`);
  }
  // Empty states (no saved cart): every button label keeps one line from 320 px (BTN8, principle 7).
  // The October 11 audit found "Browse headphones" on two lines in the empty checkout at 320 to 340 px.
  const empty = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const emptyPage = await empty.newPage();
  const wrappedLabels = () => [...document.querySelectorAll("a.button, button")].flatMap((el) => {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(el).visibility === "hidden") return [];
    // Count text lines: a rect whose middle sits below the current line's bottom starts a new line,
    // so an inline badge beside the label ("Cart 0") stays on the label's line.
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      rects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
    }
    rects.sort((a, b) => a.top - b.top);
    let lines = 0, bottom = -Infinity;
    for (const r of rects) {
      if ((r.top + r.bottom) / 2 > bottom) { lines += 1; bottom = r.bottom; } else bottom = Math.max(bottom, r.bottom);
    }
    return lines > 1 ? [`"${el.textContent.trim().slice(0, 30)}" on ${lines} lines in a ${Math.round(box.width)}px button`] : [];
  });
  for (const width of [320, 330, 340, 350, 360, 370, 380, 390, 400, 768, 1920]) {
    await emptyPage.setViewportSize({ width, height: 900 });
    await emptyPage.goto(base + "/checkout", { waitUntil: "networkidle" });
    await emptyPage.getByRole("heading", { name: "Your cart is empty" }).waitFor();
    for (const problem of await emptyPage.evaluate(wrappedLabels)) failures.push(`empty checkout @${width}: ${problem}`);
    await emptyPage.goto(base + "/", { waitUntil: "networkidle" });
    await emptyPage.locator(".cart-button").click();
    await emptyPage.locator(".cart-panel .empty-state").waitFor();
    for (const problem of await emptyPage.evaluate(wrappedLabels)) failures.push(`empty cart @${width}: ${problem}`);
  }
  await empty.close();
} finally {
  await browser.close();
}

const unique = [...new Set(failures)];
await mkdir("outputs", { recursive: true });
await writeFile("outputs/layout-findings.txt", unique.join("\n") + "\n");
console.log(unique.length ? unique.slice(0, 80).join("\n") + (unique.length > 80 ? `\n… ${unique.length - 80} more` : "") : "layout and identity: no findings");
console.log(JSON.stringify({ findings: unique.length }));
process.exitCode = unique.length ? 1 : 0;
