# Audiophile

Responsive portfolio storefront experiment adapted from Frontend Mentor's Audiophile e-commerce challenge.

## Product boundary

**Demo store (Royer, October 8, 2026).** Nothing is sold, charged for real or shipped. Every page says so, Stripe runs in test mode only and live (or restricted live) keys are refused, checkout offers **Fill sample details**, and card payment shows Stripe's test card. The store never receives name, email, phone or address: checkout validates them in the browser and keeps them there. The server keeps orders, items, totals and payment status only. Orders never paid are deleted after 7 days by a daily Vercel Cron (`/api/cron/purge-orders`, which first cancels their open card attempts at Stripe and keeps any order whose payment could hold money). Order creation and payment starts are rate limited per client address (IPv6 per /64) and per anonymous browser session, stored as HMAC buckets for up to two days.

Production settings: `CRON_SECRET` (Vercel sends it to the cron; without it the purge refuses to run) and `RATE_LIMIT_SECRET` (keys the rate-limit hashes). Cron runs only on Production, so the Preview/Development database is not purged. Dropped columns stay in Neon's point-in-time history until its retention window passes.

- Six fictional audio products across headphones, speakers, and earphones.
- The cart and payee mocks persist in the current browser. On Vercel, orders are created on the server from catalog prices before any payment and stored in PostgreSQL (Neon); the owner-only Sites fallback stays guest-only and keeps orders in the browser.
- Customer accounts use the central Breakthrough account (`@royer/auth` 0.1.0-rc.4, central mode). They are on only where the issuer registered the deployment, today the protected Preview; production says "accounts coming soon". Guest checkout always works.
- Stripe Checkout and Payment Element run in **test mode only**. Live Stripe keys are refused.
- Confirmation is not paid until Stripe test reports payment or a transfer is marked paid by hand.
- Do not collect raw card numbers. Do not send money to mock Banreservas or Popular accounts.

## Local work

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm run dev
npm test
npm run lint
npm run build:vercel
```

Stripe test keys, webhook secret, and optional `STAFF_PASSWORD` are listed in `.env.example` and `.dev.vars.example`. Copy both, then paste the same `sk_test_` / `pk_test_` values into `.env.local` and `.dev.vars`. Never commit those two files. `/orders` is open on localhost without a password. Set `STAFF_PASSWORD` before exposing that queue on a public host.

Payment click-through (every method, test cards, what not to send): [docs/payment-testing.md](docs/payment-testing.md).

To check cancelled-checkout recovery, start a native production build on `http://127.0.0.1:4346`, install Google Chrome and make Playwright available, then run `node tests/checkout-cancel.browser.mjs`. `PLAYWRIGHT_MODULE` can point to an existing Playwright `index.mjs`; `AUDIOPHILE_URL` selects another localhost server. The test uses a fresh browser, fictional details and a local substitute for Stripe's redirect. It checks pending-order retry after cart clearing without contacting Stripe or changing payment settings. Results and screenshots go to ignored `outputs/`.

Webhook URL: `/api/stripe/webhook`. Use the Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

AZUL affiliation, live bank numbers, and a live merchant account are human steps. They are tracked on `/payments`, not completed by this repo.

The project uses Next.js App Router source with two build targets: native Next.js for Vercel and vinext for Sites. Production is published at <https://audiophile.royeradames.com>; the owner-only Sites build remains available as a private fallback. Product imagery and seed copy are challenge assets; see `THIRD_PARTY_ASSETS_LICENSE.md`.

## Durable orders

`POST /api/orders` saves the order (server totals, 18% demo ITBIS) before payment. A request key makes a retried submission return the same order. Payment status is stored per Stripe PaymentIntent in `audiophile_payments`; the webhook (`/api/stripe/webhook`, each event handled once) and the return/confirmation routes settle the order idempotently, and only for the stored amount. A card retry reuses the open PaymentIntent. `GET /api/orders/<id>` returns the order status without address or email, so a confirmation link works in any browser.

Migrations live in `migrations/`, are idempotent, and are recorded with their SHA-256. Review the plan, then apply it to one named Neon database:

```bash
npm run db:plan
vercel env run -e preview -- node scripts/migrate.mjs --neon-project=<NEON_PROJECT_ID> --reviewed-sha256=<combined hash>
```

Expand/contract releases: apply up to the expand file with `--through=0004_demo_store_expand.sql` before merging, let Production deploy, then apply the rest (0005 drops the personal-detail columns). From the expand step on, roll forward rather than back: pre-demo code cannot read orders the new code created.

Run it from a checkout without `.env.local`: `vercel env run` lets that file override the chosen environment, so a Production run would otherwise reach the Development database. Preview and Development share one Neon project; Production has its own.

`migrations/0002_accounts.sql` is generated by `node scripts/plan-accounts-migration.mjs` from the vendored package.

## Customer accounts

Sign-in happens on the Breakthrough accounts site; Audiophile keeps only its own principal IDs, a host-only session and its orders. `/account` shows the signed-in customer's history. The vendored archive `vendor/royer-auth-0.1.0-rc.4.tgz` (SHA-256 `22e5e9d13d4ee67bdd51f12f21043de59d3016ea6b1b1d2d3d1289a1226348d8`) is the CI-built rc.4 release; this repository is private, so it keeps the archive instead of using the registry. Settings are listed in `.env.example`.

## Checks

- `npm test`: unit and PostgreSQL (in-memory PGlite) regressions, the Sites build and its HTML contracts, then the Vercel build and the layout and identity regression (`tests/layout-identity.browser.mjs`, about two minutes, needs Google Chrome): 15 routes at 22 widths, the phone menu, the cart dialog and each page's share card.
- `npm run build:vercel`, then `npm run test:journey`: a real-browser journey on this machine. It runs the reviewed issuer and the built app over HTTPS on `*.localhost`, signs in two synthetic accounts, pays with Stripe's published test card (test keys from `.env.local`), and checks the order history across two browsers.
- `npm run test:hosted`: the same order journey against the protected Preview (`AUDIOPHILE_PREVIEW_URL`, `AUDIOPHILE_PREVIEW_BYPASS`, `STRIPE_TEST_SECRET_KEY`); the account journey also needs the issuer's preview secrets. The **Hosted Audiophile journey** workflow runs it after each Preview deploy of the registered branch, then `scripts/cleanup-suite-data.mjs` removes the synthetic orders and local account records. Synthetic issuer accounts are the issuer's to remove.
