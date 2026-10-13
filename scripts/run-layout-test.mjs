// Starts the built Vercel target (npm run build:vercel) on a free local port,
// runs tests/layout-identity.browser.mjs and tests/cart-checkout-ui.browser.mjs
// against it, then stops the server.
// Part of npm test; needs Google Chrome (or PLAYWRIGHT_CHANNEL=chromium).
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const port = await new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { stdio: ["ignore", "ignore", "inherit"] });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    ready = await fetch(url + "/").then((response) => response.ok, () => false);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("The built app did not start; run npm run build:vercel first.");
  for (const file of ["tests/layout-identity.browser.mjs", "tests/cart-checkout-ui.browser.mjs"]) {
    const test = spawn(process.execPath, [file], { stdio: "inherit", env: { ...process.env, AUDIOPHILE_URL: url } });
    const code = await new Promise((resolve) => test.on("exit", (exit) => resolve(exit ?? 1)));
    if (code !== 0) process.exitCode = code;
  }
} finally {
  server.kill();
}
