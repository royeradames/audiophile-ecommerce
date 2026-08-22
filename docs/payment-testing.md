# Payment testing

How to prove Audiophile takes money the way the payment plan says. Test **localhost**, not https://audiophile.royeradames.com, until this work is committed and deployed.

Product source of truth: the Obsidian note `audiophile-payment.md`. This file is the click-through playbook.

## Locks

- Confirmation is **not** paid.
- Do **not** type a real card number into this shop. Stripe fields only, test cards only.
- Do **not** send RD$ to the mock Banreservas / Popular numbers (`960-000000000-1`, `730-000000000-1`).
- Do **not** paste `sk_live_` / `pk_live_` keys. The app refuses them.
- Do **not** auto-mark Zelle or a bank transfer as paid.
- Cart, payee stack, and orders live in **this browser** (`localStorage`). Use the same origin and profile for checkout and `/orders`.

## What each method must do

| Method | After Place order | Paid when |
| --- | --- | --- |
| Hosted card | Redirect to Stripe Checkout (test). Order `pending_hosted`. | Stripe reports paid → `/checkout/stripe` or webhook. |
| Own card form | Confirmation dialog + Payment Element. Order `pending_hosted`. | Element succeeds, or 3DS return / webhook. |
| DR bank transfer | Stay on confirmation. Order `pending_transfer`. | Human **Mark paid** after a real credit matches the order ID. In this pass, skip sending money. |
| Zelle | Link to `/zelle`. Order `pending_transfer`. | Human **Mark paid** after Zelle memo = order ID. Optional later: real $1. |
| Pay in person | Pickup city required. Order `pending_in_person`. | Human **Mark collected** after AZUL terminal or cash. No terminal yet. |

Order ids look like `AUD-XXXX`. Status labels on `/orders`: Pending card, Pending transfer, Pending in person, Paid, Collected, Cancelled.

## Totals to expect

Catalog prices are USD.

- Demo shipping: **$50** when the cart is not empty
- Demo ITBIS: **18%** of subtotal (not UK VAT, not a live filing)
- Demo FX: **60 DOP / USD**, labeled as demo, not a live quote

Example: XX99 Mark II at $2,999 → shipping $50 + tax $540 → **$3,589** USD. Demo DOP should mention 60.

## 0. Automated (every pass)

```bash
cd "/Users/royeradames/Documents/side projects/audiophile-ecommerce"
npm test
npm run lint
```

`npm test` runs unit tests (totals, order status machine, staff gate, webhook signatures), a vinext build, then HTML contracts for `/`, `/payments`, `/zelle`, `/orders`, `/checkout/stripe`.

Pass if all tests are green. This does **not** replace the browser click-through below.

## 1. Keys (needed for Stripe clicks only)

Copy `.env.example` to **both** `.env.local` and `.dev.vars`. Vinext reads `.dev.vars` for local server env.

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…   # from Stripe CLI listen, optional until webhook step
STAFF_PASSWORD=                 # leave empty on localhost
```

Restart `npm run dev`. Open http://localhost:3000/payments. Stripe line should say keys are configured, not missing or blocked.

Without keys: hosted card and own card form must stay unpaid and show setup copy / 503. That is a pass for the “no keys” check, a fail for the Stripe click-throughs.

## Where to get accounts and env vars

Do this in a browser. Paste values into **both** `.env.local` and `.dev.vars` in the repo root, then restart `npm run dev`. Vinext reads `.dev.vars`. Never commit those files.

### Stripe test keys (needed for hosted card and own card form)

Stay in **test / sandbox**. Do not copy `sk_live_` or `pk_live_`. This shop blocks live keys. A Dominican persona física account is fine for **test**; live Stripe merchant is parked.

| Step | URL | What to copy |
| --- | --- | --- |
| Create or sign in | https://dashboard.stripe.com/register · https://dashboard.stripe.com/login | Account |
| Test API keys | https://dashboard.stripe.com/test/apikeys | `STRIPE_PUBLISHABLE_KEY` = `pk_test_…` · `STRIPE_SECRET_KEY` = Reveal test key → `sk_test_…` |
| Key docs | https://docs.stripe.com/keys | Which key is which |
| Test cards | https://docs.stripe.com/testing | `4242…` success, `4000 0000 0000 0002` decline, `4000 0025 0000 3155` 3DS |
| Checkout docs | https://docs.stripe.com/payments/checkout | Hosted card shape |
| Payment Element docs | https://docs.stripe.com/payments/payment-element | Own card form shape |

Dashboard path if the direct link fails: **Developers → API keys**, then turn **Test mode** / sandbox on so prefixes are `pk_test_` and `sk_test_`.

### Stripe webhook secret (optional until step 10)

Local (preferred):

1. Install CLI: https://docs.stripe.com/stripe-cli
2. `stripe login` → https://dashboard.stripe.com/stripecli/confirm
3. `stripe listen --forward-to localhost:3000/api/stripe/webhook`
4. Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`

Dashboard endpoint (later, after a public URL exists): https://dashboard.stripe.com/test/webhooks → Add endpoint → `https://<host>/api/stripe/webhook` → events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded` → Signing secret `whsec_…`.

### Staff password (no vendor URL)

`STAFF_PASSWORD` is only this app. Leave it empty on localhost. Before `/orders` is on a public host, set a long password in `.dev.vars` and in Vercel env.

### Vercel env (after commit/deploy, not required for localhost)

https://vercel.com/dashboard → this Audiophile project → **Settings → Environment Variables**  
Docs: https://vercel.com/docs/environment-variables  

Add the same `STRIPE_*` test keys and `STAFF_PASSWORD`. Do not add live Stripe keys.

### AZUL (live DR cards — paperwork, not `.env` yet)

No AZUL secret belongs in `.env` until affiliation exists. File as **persona física** (individual), not a company.

| Step | URL |
| --- | --- |
| App AZUL (iPhone / iPad) | https://apps.apple.com/do/app/app-azul/id1522098862 |
| App AZUL (Android helper) | https://play.google.com/store/apps/details?id=com.sdp.appazul |
| App / affiliation overview | https://www.azul.com.do/Pages/es/app-azul.aspx |
| Evoluciona con AZUL | https://www.azul.com.do/Pages/es/evoluciona-con-azul.aspx |
| Offices (pickup) | https://www.azul.com.do/Pages/es/conocenos.aspx |
| POS | https://www.azul.com.do/pages/es/pos-azul.aspx |
| CardNET backup | https://cardnet.com.do/afiliate/personal |

In App AZUL use **Afiliarme**. Ask for Link de Pagos, terminal inalámbrica, pickup **and** delivery (Santo Domingo and Santiago). Centro AZUL: **809-544-2985** / interior **809-200-0305**.

### Banreservas / Popular / Zelle (no developer portal)

There is no API and no sandbox. Live account numbers come from the bank app or branch, then you paste them on http://localhost:3000/payments. Zelle QR is already the official bank export on `/zelle`. Do not send money to the mock numbers on that page.

## 2. Shared cart setup

Use this before every method unless a step says otherwise.

1. http://localhost:3000/headphones/xx99-mark-two-headphones
2. Add to cart → Continue to checkout
3. Billing: any valid name, email, phone
4. Shipping: any address, ZIP, city, country
5. Leave the cart in this tab. `/orders` is not in the header — open it in the same browser.

## 3. Payment stack and Zelle page (no money)

- [ ] http://localhost:3000/payments shows Banreservas, Banco Popular, Zelle, Hosted card, Own card form, Pay in person, AZUL checklist, persona física copy
- [ ] Change a bank account, Save, go to checkout, choose **DR bank transfer**, confirm the new number is on the instructions
- [ ] Restore mock defaults. Numbers are fake again (`960-…`, `730-…`)
- [ ] http://localhost:3000/zelle shows the official QR (`zelle-qr.png`) and the name **Royer Adames**
- [ ] Footer still says Stripe test cards. No PayPal. No “order complete / paid” on an unpaid transfer

## 4. Hosted card (Stripe Checkout test)

Needs test keys.

- [ ] Checkout → **Hosted card** → Place order
- [ ] Browser goes to Stripe Checkout (not our card fields)
- [ ] Pay with `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP
- [ ] Land on `/checkout/stripe`. Copy says **test payment recorded**, not a live AZUL/Stripe merchant charge
- [ ] http://localhost:3000/orders → that `AUD-` id is **Paid**

Cancel path (separate order):

- [ ] Hosted card → Place order → cancel on Stripe
- [ ] Back on checkout with a canceled hint. `/orders` still **Pending card**, not Paid
- [ ] Use **Pay with Stripe test** on that row, or retry, and pay with `4242…`

Decline path:

- [ ] Hosted card → `4000 0000 0000 0002` → Stripe refuses. Order stays pending. Do not mark paid by hand unless testing the owner override

## 5. Own card form (Payment Element test)

Needs test keys. New cart.

- [ ] Checkout → **Own card form** → Place order
- [ ] Confirmation stays on our site. Payment Element is on that dialog. Card numbers are Stripe’s fields, not our inputs
- [ ] Pay with `4242…`. Copy says test mode. `/orders` → **Paid**

3DS path (separate order):

- [ ] Use `4000 0025 0000 3155`. Complete the test authentication
- [ ] Return URL may include `payment_intent=`. `/checkout/stripe` still records paid. Order is **Paid**

## 6. DR bank transfer (no real money)

- [ ] `/payments` still shows mock accounts. Do not send RD$
- [ ] Checkout → **DR bank transfer** → Place order
- [ ] Confirmation is **not** paid. Instructions list beneficiary, cédula, both banks, amount, **referencia = order ID**
- [ ] `/orders` → **Pending transfer**. **Mark paid** → **Paid**. **Cancel** on a *new* pending transfer → **Cancelled** (cannot mark paid after cancel)

## 7. Zelle (QR now, $1 later)

- [ ] Checkout → **Zelle** → Place order
- [ ] Confirmation is not paid. Open **Pay with Zelle**. Name is Royer Adames. Memo copy is the `AUD-` id
- [ ] `/orders` → **Pending transfer** → **Mark paid**

Optional live $1 (only when ready, still human-verify):

- [ ] Second US bank app → Send → scan the official QR
- [ ] Confirm name **Royer Adames**
- [ ] Amount $1. Memo = that order ID
- [ ] Then **Mark paid**. Never treat the scan itself as paid

## 8. Pay in person

- [ ] Checkout → **Pay in person** without a city → validation asks for Santo Domingo or Santiago
- [ ] Choose a city → Place order. Confirmation mentions pickup city and the dedicated AZUL terminal. iPhone/iPad cannot tap-to-accept
- [ ] `/orders` → **Pending in person**. **Mark collected** → **Collected**. There is no **Mark paid** on this row
- [ ] Do not pretend a terminal charge happened. Affiliation is still paperwork

## 9. Staff gate

- [ ] On localhost with `STAFF_PASSWORD` empty, `/orders` opens (dev-open)
- [ ] `/orders` is not a public header link
- [ ] Set `STAFF_PASSWORD` in `.dev.vars`, restart, `/orders` asks for the password. Wrong password fails. Right password opens the queue
- [ ] Off localhost without a password, the queue stays closed (unconfigured). Do not ship `/orders` public without a password

## 10. Webhook (optional, Stripe CLI)

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Put the printed `whsec_…` in `.dev.vars` and restart.

- [ ] Complete a hosted or Element test payment
- [ ] CLI shows `checkout.session.completed` or `payment_intent.succeeded` → 200
- [ ] `payment_intent.created` or a canceled session must **not** mark the order paid
- [ ] Refresh `/orders` — Paid, even if the return page was skipped

## 11. Wallets (optional)

On a device that supports them, Apple Pay / Google Pay may appear on Stripe Checkout or Payment Element in test mode. If they do, a test payment should still land as Paid. If they do not, that is not a fail for this plan. Live DR wallets wait on AZUL.

## 12. What this pass does not test

| Skip | Why |
| --- | --- |
| Production https://audiophile.royeradames.com | Still Version 1 simulated checkout until deploy |
| Live Stripe charges | No live keys. Blocked on purpose |
| AZUL Link / POS | Affiliation not filed |
| Real Banreservas / Popular credits | Mock account numbers |
| PayPal, Amazon Pay, Temu buttons | Not on this storefront |
| Typing PAN into our billing form | Must never exist |

## Pass log

Date: 2026-08-22

- [x] `npm test` + `npm run lint` (earlier this session)
- [x] Payment stack + Zelle page
- [ ] Hosted card 4242 + cancel + decline — **blocked:** no `sk_test_` / `pk_test_` yet. Without keys, hosted card stayed unpaid with setup copy (pass for the no-keys path)
- [ ] Own card form 4242 + 3DS — blocked on the same keys
- [x] DR transfer mark-paid (no RD$ sent)
- [x] Zelle mark-paid (QR checked; $1 not sent)
- [x] In-person mark-collected
- [x] Staff gate open on localhost
- [ ] Webhook (CLI not run)

Get keys: https://dashboard.stripe.com/test/apikeys

## Stripe test cards

From [Stripe test cards](https://docs.stripe.com/testing). Use Stripe’s fields only.

| Card | What it does |
| --- | --- |
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Decline |
| `4000 0025 0000 3155` | 3D Secure |

Any future expiry, any 3-digit CVC, any ZIP.
