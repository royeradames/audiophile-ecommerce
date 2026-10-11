import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_SHIPPING_USD,
  VAT_RATE,
  checkoutTotals,
  formatDopFromUsd,
  usdToCents,
} from "../app/checkout-totals.ts";

test("empty cart has no shipping or VAT", () => {
  assert.deepEqual(checkoutTotals(0), {
    subtotal: 0,
    shipping: 0,
    vat: 0,
    grandTotal: 0,
  });
});

test("VAT is the brief's 20% of the product total, already included in it", () => {
  const totals = checkoutTotals(2999);
  assert.equal(VAT_RATE, 0.2);
  assert.equal(totals.shipping, DEMO_SHIPPING_USD);
  assert.equal(totals.vat, 600);
  assert.equal(totals.grandTotal, 2999 + 50);
});

test("matches the brief's checkout design: $5,396 + $50 shipping, $1,079 VAT included, $5,446 grand total", () => {
  assert.deepEqual(checkoutTotals(5396), {
    subtotal: 5396,
    shipping: 50,
    vat: 1079,
    grandTotal: 5446,
  });
});

test("converts USD cents and labels DOP as a demo FX amount", () => {
  assert.equal(usdToCents(3049), 304900);
  assert.match(formatDopFromUsd(1), /60/);
});
