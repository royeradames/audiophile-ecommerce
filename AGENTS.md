# audiophile-ecommerce

Instructions for agents working in this repo.

## Styling: Tailwind first

Royer, Oct 28, 2026: "I was expecting us to use default tailwind classes for the most part and for us to have a justification and log it when we don't."

- Layout, spacing, sizing, colour tokens and type use Tailwind utilities. Write custom CSS only where Tailwind can't express it, and give each such rule a `/* why: ... */` comment.
- Build dynamic class names with `cn()` (clsx + tailwind-merge), never string concatenation or template literals, so conflicting utilities resolve and unused ones stay out. This repo has no cn() yet; add it at lib/utils.ts (clsx + tailwind-merge) in the first PR that needs a dynamic class.

## Checks

Merges run change-scoped checks from `.affected-checks.json` (royer-merge): lint, the unit tests and `next build` run on boat boxes; GitHub CI runs the full `npm test`. Installs stay on npm for now because CI runs `npm ci`.
