# Audiophile

Responsive portfolio storefront experiment adapted from Frontend Mentor's Audiophile e-commerce challenge.

## Product boundary

- Six fictional audio products across headphones, speakers, and earphones.
- The cart persists only in the current browser.
- Checkout validates the complete interaction but never charges, sends, or stores personal information.
- Version 1 has no account, order database, analytics, or live payment provider.

## Local work

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
npm test
npm run lint
npm run build:vercel
```

The project uses Next.js App Router source with two build targets: native Next.js for Vercel and vinext for Sites. Production is published at <https://audiophile.royeradames.com>; the owner-only Sites build remains available as a private fallback. Product imagery and seed copy are challenge assets; see `THIRD_PARTY_ASSETS_LICENSE.md`.
