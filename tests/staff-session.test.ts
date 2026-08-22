import assert from "node:assert/strict";
import test from "node:test";
import { isLocalHost, staffAccessFromHost } from "../app/staff-session.ts";

function withStaffPassword<T>(value: string | undefined, run: () => T) {
  const previous = process.env.STAFF_PASSWORD;
  if (value === undefined) {
    delete process.env.STAFF_PASSWORD;
  } else {
    process.env.STAFF_PASSWORD = value;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.STAFF_PASSWORD;
    } else {
      process.env.STAFF_PASSWORD = previous;
    }
  }
}

test("localhost is open without a staff password; public hosts are not", () => {
  withStaffPassword(undefined, () => {
    assert.equal(isLocalHost("localhost"), true);
    assert.deepEqual(staffAccessFromHost("localhost", false), { ok: true, mode: "dev-open" });
    assert.deepEqual(staffAccessFromHost("audiophile.royeradames.com", false), {
      ok: false,
      mode: "unconfigured",
    });
  });
});

test("a staff password requires the signed cookie on every host", () => {
  withStaffPassword("test-staff", () => {
    assert.deepEqual(staffAccessFromHost("localhost", false), { ok: false, mode: "login" });
    assert.deepEqual(staffAccessFromHost("localhost", true), { ok: true, mode: "password" });
  });
});
