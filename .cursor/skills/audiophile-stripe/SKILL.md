---
name: audiophile-stripe
description: >-
  Routes Stripe work for this Audiophile shop. Loads stripe-best-practices and
  stripe-docs; skips Connect, Stripe Apps, Stripe Projects, Directory, and
  upgrade-stripe. Use when editing Stripe Checkout, Payment Element, webhooks,
  API keys, test mode, or looking up docs.stripe.com. Stripe is test-only; the
  live DR card rail is AZUL persona física.
---

# Audiophile Stripe

Stripe’s agent skills are in this project. I ran npx skills add https://docs.stripe.com and installed all 8 skills.

They live in .agents/skills/ (official install) and are linked into .cursor/skills/ so Cursor can see them. A new chat may be needed before they show up in the skill list.

The ones that matter for this shop:

stripe-best-practices — Checkout vs Payment Element, keys, webhooks
stripe-docs — look up docs with stripe docs instead of scraping the site
The rest came with the catalog: Connect, Stripe Apps, Stripe Projects, Directory, upgrade-stripe. We are not a Connect platform, so those stay unused.

They do not auto-update. Later: npx skills update -y. Nothing is committed unless you ask.

## Load these first

Read, in order:

1. `.agents/skills/stripe-best-practices/SKILL.md`
2. `.agents/skills/stripe-best-practices/references/payments.md`
3. `.agents/skills/stripe-best-practices/references/security.md`
4. `.agents/skills/stripe-docs/SKILL.md`

Skip `references/connect.md`, `billing.md`, `tax.md`, and `treasury.md` unless asked.

## Docs lookup

```bash
stripe docs /payments/checkout
stripe docs search "webhook signature"
stripe docs api checkout.sessions
```

Do not `curl` or WebFetch docs.stripe.com. Stripe MCP doc search is a fallback if `stripe docs` is unavailable.

## This shop

- **Test keys only.** `app/stripe-env.ts` refuses `sk_live_` / `pk_live_`. Do not paste live keys. Do not ship a live Stripe merchant.
- **Live DR cards = AZUL persona física.** Do not land Stripe live + AZUL in one diff.
- Checkout already has hosted Checkout and Payment Element. Extend `app/stripe-api.ts`, `app/api/stripe/*`, and `app/stripe-webhook.ts`. Do not add the Stripe Node SDK unless asked.
- Webhooks are required. Paid events in this app: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`. Verify HMAC. Do not fulfill from the success page alone.
- Demo 18% ITBIS is computed in the app. Do not enable Stripe Tax.
- Do not commit `.dev.vars` or `.env.local`.

This skill is not in `skills-lock.json`. After `npx skills update -y`, restore `.cursor/skills/audiophile-stripe/` if the catalog rebuild dropped it.
