import test from "node:test";
import assert from "node:assert/strict";
import { type Anchor, type Track, anchorOf, assign, dedupeAnchors, expected, followPeople, followPerson, largestAnchor, locatePick, nextAnchor, pickAnchor } from "../lib/follow";
import { LM } from "../lib/skeleton";

/** A standing figure with hips at (x, y), `h` tall, as an x/y/visibility buffer. */
function figure(x: number, y: number, h = 0.4, vis = 1): Float32Array {
  const buf = new Float32Array(33 * 3);
  for (let i = 0; i < 33; i++) { buf[i * 3] = x; buf[i * 3 + 1] = y; buf[i * 3 + 2] = vis; }
  const set = (lm: number, dx: number, dy: number) => { buf[lm * 3] = x + dx * h; buf[lm * 3 + 1] = y + dy * h; };
  set(LM.nose, 0, -0.55);
  set(LM.leftShoulder, 0.12, -0.35); set(LM.rightShoulder, -0.12, -0.35);
  set(LM.leftHip, 0.08, 0); set(LM.rightHip, -0.08, 0);
  set(LM.leftAnkle, 0.08, 0.45); set(LM.rightAnkle, -0.08, 0.45);
  return buf;
}
const A = (x: number, y: number, h = 0.4): Anchor => anchorOf(figure(x, y, h))!;

test("anchorOf reads the hips and the body's size", () => {
  const a = A(0.3, 0.5);
  assert.ok(Math.abs(a.x - 0.3) < 1e-6 && Math.abs(a.y - 0.5) < 1e-6);
  assert.ok(Math.abs(a.size - 0.4) < 1e-6, `size ${a.size}`);
  assert.equal(anchorOf(figure(0.3, 0.5, 0.4, 0.1)), null);
});

test("pickAnchor prefers the body under the tap, then the nearest one in reach", () => {
  const people = [A(0.2, 0.5), A(0.6, 0.5), A(0.9, 0.5)];
  assert.equal(pickAnchor(people, { x: 0.6, y: 0.4 }), 1);
  // A tap on the chest, not on a landmark, still lands inside the box.
  assert.equal(pickAnchor(people, { x: 0.22, y: 0.4 }), 0);
  // Near, but outside every box: nearest hips.
  assert.equal(pickAnchor(people, { x: 0.5, y: 0.5 }), 1);
  // Far from everyone: nobody.
  assert.equal(pickAnchor(people, { x: 0.5, y: 0.05 }), -1);
  assert.equal(largestAnchor([A(0.2, 0.5, 0.3), A(0.6, 0.5, 0.5), null]), 1);
});

test("nextAnchor keeps identity across a crossing and refuses a distant stand-in", () => {
  const last = A(0.5, 0.5);
  assert.equal(nextAnchor([A(0.9, 0.5), A(0.53, 0.5)], last), 1);
  // Nobody within reach: lost, not swapped.
  assert.equal(nextAnchor([A(0.9, 0.5)], last), -1);
  // After a long gap the reach grows, so they can be found again — but not across the room.
  assert.equal(nextAnchor([A(1.0, 0.5)], last, 20), -1);
  assert.equal(nextAnchor([A(0.8, 0.5)], last, 6), 0);
  // Same spot but a very different size is someone else (a child, or a face close to the lens).
  assert.equal(nextAnchor([A(0.5, 0.5, 0.1)], last), -1);
});

test("followPerson walks both ways from the pick and survives being lost for a while", () => {
  // Frames: the dancer travels left to right; a bystander stands upstage and never moves.
  const bystander = A(0.9, 0.15);
  const frames: (Anchor | null)[][] = [];
  for (let f = 0; f < 40; f++) {
    const x = 0.1 + f * 0.02;
    const dancer = A(x, 0.55, 0.35);
    // The detector loses the dancer for a few frames.
    frames.push(f >= 18 && f < 23 ? [bystander] : f % 2 ? [bystander, dancer] : [dancer, bystander]);
  }
  // Picked on frame 30 (dancer at index 0 there).
  const chosen = followPerson(frames, { frame: 30, index: 0 });
  for (let f = 0; f < 40; f++) {
    if (f >= 18 && f < 23) assert.equal(chosen[f], -1, `frame ${f} should be lost`);
    else assert.equal(frames[f][chosen[f]], frames[f].find((a) => a!.size < 0.4), `frame ${f}`);
  }
});

test("locatePick tolerates a missed detection on the tapped frame", () => {
  const frames: (Anchor | null)[][] = [[A(0.3, 0.5)], [], [A(0.3, 0.5), A(0.8, 0.5)], [A(0.3, 0.5)]];
  assert.deepEqual(locatePick(frames, { x: 0.8, y: 0.5 }, 1), { frame: 2, index: 1 });
  assert.deepEqual(locatePick(frames, { x: 0.3, y: 0.5 }, 1), { frame: 0, index: 0 });
  assert.equal(locatePick(frames, { x: 0.8, y: 0.5 }, 3, 0), null);
});

test("followPerson reseeds onto the biggest body only when asked, and only after the wait", () => {
  const a = A(0.2, 0.5), b = A(0.8, 0.5, 0.5);
  // The picked person (a) leaves after frame 2; b is far away throughout.
  const frames: (Anchor | null)[][] = [[a, b], [a, b], [a, b], [b], [b], [b], [b]];
  assert.deepEqual(followPerson(frames, { frame: 0, index: 0 }), [0, 0, 0, -1, -1, -1, -1]);
  assert.deepEqual(followPerson(frames, { frame: 0, index: 0 }, { reseedAfter: 2 }), [0, 0, 0, -1, -1, 0, 0]);
});

test("dedupeAnchors keeps one box per person", () => {
  assert.deepEqual(dedupeAnchors([A(0.3, 0.5), A(0.31, 0.52, 0.42), A(0.7, 0.5), null, A(0.3, 0.5, 0.12)]), [0, 2, 4]);
});

/* ---------- several dancers at once ---------- */


/** A figure with a flat colour signature in one bin, so the clothes can be told apart. */
const dressed = (x: number, y: number, bin: number, h = 0.4): Anchor => {
  const sig = new Float32Array(64); sig[bin] = 1;
  return { ...A(x, y, h), sig };
};
const track = (last: Anchor, prev: Anchor | null = null, gap = 0): Track => ({ last, prev, gap, sig: last.sig ?? null });

test("expected carries a little of the last motion on, capped and only when seen on consecutive frames", () => {
  const moving = track(A(0.5, 0.5), A(0.4, 0.5));
  const e = expected(moving);
  assert.ok(e.x > 0.5 && e.x < 0.6, `leads by ${e.x - 0.5}`);
  assert.deepEqual(expected(track(A(0.5, 0.5), A(0.4, 0.5), 1)), track(A(0.5, 0.5)).last);
  const leap = expected(track(A(0.9, 0.5), A(0.1, 0.5)));
  assert.ok(leap.x - 0.9 <= 0.5 * 0.4 + 1e-9, "capped");
});

test("assign gives each body to at most one dancer, at the least total cost", () => {
  const a = track(A(0.30, 0.5)), b = track(A(0.34, 0.5));
  // One body between them near both: the nearer dancer takes it, the other goes unmatched.
  assert.deepEqual(assign([a, b], [A(0.31, 0.5)]), [0, -1]);
  // Two bodies: the cheaper pairing overall, even though b's nearest is a's body.
  assert.deepEqual(assign([a, b], [A(0.36, 0.5), A(0.31, 0.5)]), [1, 0]);
  // A body already taken (pinned to someone else) is off limits.
  assert.deepEqual(assign([a], [A(0.31, 0.5), A(0.5, 0.5)], [true]), [1]);
});

test("followPeople keeps two dancers apart through a crossing", () => {
  // A walks left to right, B right to left, meeting in the middle on frame 10.
  const frames: (Anchor | null)[][] = [];
  for (let f = 0; f < 21; f++) {
    const ax = 0.2 + f * 0.03, bx = 0.8 - f * 0.03;
    const a = A(ax, 0.5, 0.35), b = A(bx, 0.5, 0.35);
    frames.push(f % 2 ? [b, a] : [a, b]);
  }
  const [ta, tb] = followPeople(frames, [{ frame: 0, index: 0 }, { frame: 0, index: 1 }]);
  for (let f = 0; f < 21; f++) {
    const a = frames[f][ta[f]], b = frames[f][tb[f]];
    assert.ok(a && b, `frame ${f} both seen`);
    assert.notEqual(ta[f], tb[f], `frame ${f} never the same body`);
    assert.ok(Math.abs(a!.x - (0.2 + f * 0.03)) < 1e-6, `frame ${f}: A is A`);
  }
});

test("followPeople lets the clothes settle a crossing that position cannot", () => {
  // Both stand still and close, then the detector swaps their order and jitters them past each other.
  const frames: (Anchor | null)[][] = [];
  for (let f = 0; f < 12; f++) {
    const red = dressed(0.45 + (f >= 6 ? 0.06 : 0), 0.5, 3);
    const blue = dressed(0.51 - (f >= 6 ? 0.06 : 0), 0.5, 40);
    frames.push(f % 3 ? [blue, red] : [red, blue]);
  }
  const [r, b] = followPeople(frames, [{ frame: 0, index: 0 }, { frame: 0, index: 1 }]);
  for (let f = 0; f < 12; f++) {
    assert.equal(frames[f][r[f]]!.sig![3], 1, `frame ${f}: red stays red`);
    assert.equal(frames[f][b[f]]!.sig![40], 1, `frame ${f}: blue stays blue`);
  }
});

test("followPeople: a dancer picked late cannot take a body that already belongs to someone", () => {
  // A stands at 0.3 throughout; B is only in frame from 5, picked on frame 8.
  const frames: (Anchor | null)[][] = [];
  for (let f = 0; f < 12; f++) frames.push(f < 5 ? [A(0.3, 0.5)] : [A(0.3, 0.5), A(0.36, 0.5)]);
  const [ta, tb] = followPeople(frames, [{ frame: 0, index: 0 }, { frame: 8, index: 1 }]);
  for (let f = 0; f < 12; f++) {
    assert.equal(ta[f], 0, `frame ${f}: A keeps A`);
    assert.equal(tb[f], f < 5 ? -1 : 1, `frame ${f}: B`);
  }
});

test("followPeople survives one dancer being lost while the other stays", () => {
  const frames: (Anchor | null)[][] = [];
  for (let f = 0; f < 20; f++) {
    const a = A(0.2 + f * 0.01, 0.5), b = A(0.7, 0.5);
    frames.push(f >= 8 && f < 12 ? [b] : [a, b]);
  }
  const [ta, tb] = followPeople(frames, [{ frame: 0, index: 0 }, { frame: 0, index: 1 }]);
  for (let f = 0; f < 20; f++) {
    assert.equal(tb[f], frames[f].length - 1, `frame ${f}: B`);
    assert.equal(ta[f], f >= 8 && f < 12 ? -1 : 0, `frame ${f}: A`);
  }
});

test("assign copes with a crowd (greedy past the exhaustive limit) and keeps bodies exclusive", () => {
  const tracks: Track[] = [], bodies: Anchor[] = [];
  for (let k = 0; k < 10; k++) { tracks.push(track(A(0.05 + k * 0.1, 0.5, 0.2))); bodies.push(A(0.06 + k * 0.1, 0.5, 0.2)); }
  const out = assign(tracks, bodies.slice().reverse());
  assert.equal(new Set(out).size, 10, "all distinct");
  out.forEach((i, k) => assert.equal(i, 9 - k, `track ${k}`));
});
