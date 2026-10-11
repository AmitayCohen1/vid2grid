import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAgent, MAX_BATCH, sanitizeBatch } from "../lib/events";

const ids = { visitor: "1b2c3d4e-aaaa-bbbb-cccc-000000000001", session: "1b2c3d4e-aaaa-bbbb-cccc-000000000002" };

test("rejects malformed batches", () => {
  assert.equal(sanitizeBatch(null), null);
  assert.equal(sanitizeBatch({ ...ids, visitor: "x" , events: [] }), null);
  assert.equal(sanitizeBatch({ ...ids, session: "<script>alert(1)</script>", events: [] }), null);
  assert.equal(sanitizeBatch({ ...ids, events: "nope" }), null);
});

test("keeps good events and drops bad names", () => {
  const rows = sanitizeBatch({ ...ids, events: [{ name: "dance_ready", path: "/" }, { name: "DROP TABLE" }, { name: "" }, { name: 5 }] });
  assert.deepEqual(rows?.map((r) => r.name), ["dance_ready"]);
  assert.equal(rows?.[0].path, "/");
});

test("props stay flat, finite and short", () => {
  const [row] = sanitizeBatch({ ...ids, events: [{ name: "x", props: { a: 1, b: "s".repeat(500), c: { deep: 1 }, d: NaN, e: true, f: null, "Bad Key": 1 } }] })!;
  assert.deepEqual(Object.keys(row.props).sort(), ["a", "b", "e", "f"]);
  assert.equal((row.props.b as string).length, 120);
});

test("caps the batch and clamps the client clock", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const rows = sanitizeBatch({ ...ids, events: Array.from({ length: 100 }, () => ({ name: "play", t: 0 })) }, now)!;
  assert.equal(rows.length, MAX_BATCH);
  assert.equal(rows[0].ts, new Date(now).toISOString());
  assert.equal(sanitizeBatch({ ...ids, events: [{ name: "play", path: "https://evil" }] }, now)![0].path, null);
});

test("bots and headless browsers are not visitors", () => {
  assert.equal(describeAgent("Googlebot/2.1").device, null);
  assert.equal(describeAgent("Mozilla/5.0 HeadlessChrome/120").device, null);
  assert.deepEqual(describeAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17 Mobile/15E148 Safari/604.1"), { device: "mobile", browser: "Safari" });
  assert.deepEqual(describeAgent("Mozilla/5.0 (Macintosh) AppleWebKit Chrome/130 Safari/537.36"), { device: "desktop", browser: "Chrome" });
});
