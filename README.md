# Audiophile

Responsive portfolio storefront experiment adapted from Frontend Mentor's Audiophile e-commerce challenge.

## Product boundary

- Six fictional audio products across headphones, speakers, and earphones.
- Cart, payee mocks, and transfer/Zelle/in-person orders persist in the current browser.
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

Webhook URL: `/api/stripe/webhook`. Use the Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

AZUL affiliation, live bank numbers, and a live merchant account are human steps. They are tracked on `/payments`, not completed by this repo.

The project uses Next.js App Router source with two build targets: native Next.js for Vercel and vinext for Sites. Production is published at <https://audiophile.royeradames.com>; the owner-only Sites build remains available as a private fallback. Product imagery and seed copy are challenge assets; see `THIRD_PARTY_ASSETS_LICENSE.md`.
