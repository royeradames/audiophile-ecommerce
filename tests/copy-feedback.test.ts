// Copy buttons give new feedback on every press (catalog CPY1).
import test from "node:test";
import assert from "node:assert/strict";
import { createCopyFeedback, writeToClipboard, type CopySnapshot } from "../app/copy-feedback.ts";

const make = (ok = true) => {
  const seen: CopySnapshot[] = [];
  const feedback = createCopyFeedback({ onChange: (snapshot) => seen.push(snapshot), write: async () => ok });
  return { feedback, seen };
};

test("every press changes the label and the announcement, clearing the status first", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { feedback } = make();
  await feedback.copy("t", "the token");
  t.mock.timers.tick(100);
  assert.deepEqual([feedback.snapshot().label, feedback.snapshot().message], ["Copied", "Copied the token."]);
  await feedback.copy("t", "the token");
  assert.equal(feedback.snapshot().message, "", "cleared before the new text");
  t.mock.timers.tick(100);
  assert.deepEqual([feedback.snapshot().label, feedback.snapshot().message], ["Copied ×2", "Copied the token (2)."]);
  await feedback.copy("t", "the token");
  t.mock.timers.tick(100);
  assert.deepEqual([feedback.snapshot().label, feedback.snapshot().message], ["Copied ×3", "Copied the token (3)."]);
});

test("the label goes back to idle after 2 s; counting starts again after 6 s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { feedback } = make();
  await feedback.copy("t", "the token");
  t.mock.timers.tick(2000);
  assert.equal(feedback.snapshot().state, "idle");
  await feedback.copy("t", "the token");
  assert.equal(feedback.snapshot().label, "Copied ×2", "a press after the label reset still looks new");
  t.mock.timers.tick(6000);
  assert.deepEqual([feedback.snapshot().count, feedback.snapshot().message], [0, ""]);
  await feedback.copy("t", "the token");
  assert.equal(feedback.snapshot().label, "Copied");
});

test("a rejected clipboard says so, never shows Copied, and the message stays", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { feedback, seen } = make(false);
  await feedback.copy("t", "the token");
  t.mock.timers.tick(100);
  assert.equal(feedback.snapshot().label, "Copy failed");
  assert.equal(feedback.snapshot().message, "Couldn't copy the token. Select the text and copy it by hand.");
  assert.equal(seen.some((snapshot) => /Copied/.test(snapshot.label + snapshot.message)), false);
  t.mock.timers.tick(10000);
  assert.match(feedback.snapshot().message, /Couldn't copy/);
});

test("writeToClipboard reports a rejection instead of throwing", async () => {
  const clipboard = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } } } });
  try {
    assert.equal(await writeToClipboard("x"), false);
  } finally {
    if (clipboard) Object.defineProperty(globalThis, "navigator", clipboard);
  }
});
