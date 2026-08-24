import { test } from "node:test";
import assert from "node:assert/strict";
import { describeError } from "../lib/errors";

test("describeError returns an Error's message", () => {
  assert.equal(describeError(new Error("boom")), "boom");
});

test("describeError never yields '[object Event]' for a DOM Event", () => {
  const ev = new Event("error");
  const s = describeError(ev);
  assert.doesNotMatch(s, /\[object/);
  assert.match(s, /error/i);
});

test("describeError passes a string through", () => {
  assert.equal(describeError("oops"), "oops");
});

test("describeError falls back to String() for other values", () => {
  assert.equal(describeError(42), "42");
});
