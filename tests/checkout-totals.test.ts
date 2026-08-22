import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_ITBIS_RATE,
  DEMO_SHIPPING_USD,
  checkoutTotals,
  formatDopFromUsd,
  usdToCents,
} from "../app/checkout-totals.ts";

test("empty cart has no shipping or tax", () => {
  assert.deepEqual(checkoutTotals(0), {
    subtotal: 0,
    shipping: 0,
    tax: 0,
    grandTotal: 0,
  });
});

test("uses demo USD shipping and 18% ITBIS-shaped tax", () => {
  const totals = checkoutTotals(2999);
  assert.equal(totals.shipping, DEMO_SHIPPING_USD);
  assert.equal(totals.tax, Math.round(2999 * DEMO_ITBIS_RATE));
  assert.equal(totals.grandTotal, 2999 + 50 + 540);
  assert.equal(DEMO_ITBIS_RATE, 0.18);
});

test("converts USD cents and labels DOP as a demo FX amount", () => {
  assert.equal(usdToCents(3589), 358900);
  assert.match(formatDopFromUsd(1), /60/);
});
