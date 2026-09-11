import test from "node:test";
import assert from "node:assert/strict";
import { SIG_BINS, torsoSignature } from "../lib/appearance";
import { sigDistance } from "../lib/follow";
import { LM } from "../lib/skeleton";

/** A w×h frame painted one colour, with a rectangle of another over the torso. */
function frame(w: number, h: number, bg: [number, number, number], top: [number, number, number], box: [number, number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= box[0] * w && x < box[2] * w && y >= box[1] * h && y < box[3] * h;
    const c = inside ? top : bg;
    px.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return px;
}
/** Landmarks with shoulders and hips spanning the given box (fractions). */
function torso(x0: number, y0: number, x1: number, y1: number, vis = 1) {
  const lm = new Float32Array(33 * 3);
  const set = (i: number, x: number, y: number) => { lm[i * 3] = x; lm[i * 3 + 1] = y; lm[i * 3 + 2] = vis; };
  set(LM.leftShoulder, x1, y0); set(LM.rightShoulder, x0, y0); set(LM.leftHip, x1, y1); set(LM.rightHip, x0, y1);
  return lm;
}

test("torsoSignature reads the clothes, not the background", () => {
  const px = frame(40, 40, [20, 200, 20], [220, 20, 20], [0.2, 0.2, 0.5, 0.7]);
  const sig = torsoSignature(px, 40, 40, torso(0.2, 0.2, 0.5, 0.7))!;
  assert.equal(sig.length, SIG_BINS);
  assert.ok(Math.abs(sig.reduce((a, b) => a + b, 0) - 1) < 1e-6);
  // All of it is red: the (3, 0, 0) bin.
  assert.ok(sig[3 * 16] > 0.99, `red bin ${sig[3 * 16]}`);
});

test("torsoSignature refuses a hidden or tiny torso", () => {
  const px = frame(40, 40, [0, 0, 0], [0, 0, 0], [0, 0, 0, 0]);
  assert.equal(torsoSignature(px, 40, 40, torso(0.2, 0.2, 0.5, 0.7, 0.1)), null);
  assert.equal(torsoSignature(px, 40, 40, torso(0.2, 0.2, 0.22, 0.22)), null);
});

test("sigDistance tells a red top from a blue one and matches like with like", () => {
  const red = torsoSignature(frame(30, 30, [0, 0, 0], [230, 30, 30], [0.1, 0.1, 0.9, 0.9]), 30, 30, torso(0.1, 0.1, 0.9, 0.9))!;
  const red2 = torsoSignature(frame(30, 30, [0, 0, 0], [200, 40, 20], [0.1, 0.1, 0.9, 0.9]), 30, 30, torso(0.1, 0.1, 0.9, 0.9))!;
  const blue = torsoSignature(frame(30, 30, [0, 0, 0], [30, 30, 230], [0.1, 0.1, 0.9, 0.9]), 30, 30, torso(0.1, 0.1, 0.9, 0.9))!;
  assert.ok(sigDistance(red, red2) < 0.05);
  assert.ok(sigDistance(red, blue) > 0.95);
});
