import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrder,
  cancelOrder,
  initialStatus,
  markCollected,
  markPaid,
  parseOrders,
  type OrderDraft,
} from "../app/order-record.ts";

const now = "2026-08-22T16:00:00.000Z";

const draft: OrderDraft = {
  id: "AUD-TEST",
  createdAt: now,
  payment: "transfer",
  pickupCity: "",
  customer: {
    name: "Alex Morgan",
    email: "alex@example.com",
    phone: "+1 202 555 0148",
    address: "1137 Sound Avenue",
    zip: "10001",
    city: "New York",
    country: "United States",
  },
  lines: [{ productId: "xx99-mark-two-headphones", name: "XX99 Mark II", quantity: 1, unitPrice: 2999 }],
  subtotal: 2999,
  shipping: 50,
  vat: 600,
  grandTotal: 3049,
};

test("maps each checkout method to a pending status", () => {
  assert.equal(initialStatus("hosted"), "pending_hosted");
  assert.equal(initialStatus("element"), "pending_hosted");
  assert.equal(initialStatus("transfer"), "pending_transfer");
  assert.equal(initialStatus("zelle"), "pending_transfer");
  assert.equal(initialStatus("in_person"), "pending_in_person");
});

test("buildOrder starts unpaid with a pending status", () => {
  const order = buildOrder(draft);
  assert.equal(order.id, "AUD-TEST");
  assert.equal(order.status, "pending_transfer");
  assert.equal(order.settledAt, null);
  assert.equal(order.grandTotal, 3049);
});

test("markPaid settles hosted and transfer orders only", () => {
  const transfer = markPaid(buildOrder(draft), now);
  assert.equal(transfer.status, "paid");
  assert.equal(transfer.settledAt, now);

  const zelle = markPaid(buildOrder({ ...draft, payment: "zelle" }), now);
  assert.equal(zelle.status, "paid");

  const hosted = markPaid(buildOrder({ ...draft, payment: "hosted" }), now);
  assert.equal(hosted.status, "paid");

  const element = markPaid(buildOrder({ ...draft, payment: "element" }), now);
  assert.equal(element.status, "paid");

  const inPerson = buildOrder({ ...draft, payment: "in_person", pickupCity: "santiago" });
  assert.equal(markPaid(inPerson, now), inPerson);
});

test("markCollected settles in-person orders only", () => {
  const inPerson = markCollected(
    buildOrder({ ...draft, payment: "in_person", pickupCity: "santo_domingo" }),
    now,
  );
  assert.equal(inPerson.status, "in_person_collected");
  assert.equal(inPerson.settledAt, now);

  const transfer = buildOrder(draft);
  assert.equal(markCollected(transfer, now), transfer);
});

test("cancelOrder only cancels pending orders", () => {
  const cancelled = cancelOrder(buildOrder(draft));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.settledAt, null);

  const paid = markPaid(buildOrder(draft), now);
  assert.equal(cancelOrder(paid), paid);
});

test("parseOrders keeps valid records and drops garbage", () => {
  const valid = buildOrder(draft);
  const parsed = parseOrders([valid, { id: "nope" }, null, "AUD-X"]);
  assert.deepEqual(parsed, [valid]);
  assert.deepEqual(parseOrders("not-an-array"), []);
});
