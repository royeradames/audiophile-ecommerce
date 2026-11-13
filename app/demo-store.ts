/**
 * Royer, October 8, 2026: "We don't have the items to actually sell, so we
 * need a solution where we can test things out but not actually sell them."
 * The whole store is a demo: the flow is real, nothing is sold, charged for
 * real or shipped, and Stripe runs in test mode only. There is no switch to
 * turn this off; selling for real would be a separate, reviewed change.
 */
export const DEMO_STORE = true;

export const demoNotice = "Demo store: nothing is sold, charged or shipped.";
export const testCardHint =
  "Use Stripe's test card 4242 4242 4242 4242 with any future expiry date and any CVC. Never enter a real card.";

/** Fictional details for testing checkout. Validation still runs on them. */
export const sampleCheckoutDetails = {
  name: "Sam Sample",
  email: "sam.sample@example.com",
  phone: "+1 202 555 0148",
  address: "1 Demo Street",
  zip: "10001",
  city: "New York",
  country: "United States",
} as const;
