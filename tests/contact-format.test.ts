import assert from "node:assert/strict";
import test from "node:test";
import { isPhoneNumber, isPostalCode } from "../app/contact-format.ts";

// Frontend Mentor solution report, October 13, 2026: phone and ZIP accepted any text.
test("phone numbers in common shapes pass and plain text fails", () => {
  for (const ok of ["+1 202 555 0148", "(809) 555-0100", "8095550100", "+44 20 7946 0958"]) {
    assert.equal(isPhoneNumber(ok), true, ok);
  }
  for (const bad of ["abc", "555", "call me", "+1 202 555 01ab", "1234567890123456"]) {
    assert.equal(isPhoneNumber(bad), false, bad);
  }
});

test("postal codes in common shapes pass and plain text fails", () => {
  for (const ok of ["10001", "10001-1234", "SW1A 1AA", "K1A 0B1", "10101"]) {
    assert.equal(isPostalCode(ok), true, ok);
  }
  for (const bad of ["abc", "ab", "#1000", "12345678901", "zip code"]) {
    assert.equal(isPostalCode(bad), false, bad);
  }
});
