import { test } from "node:test";
import assert from "node:assert/strict";
import { boxSmooth, imageToWorld, videoAnchors } from "../lib/invideo";
import { LM } from "../lib/skeleton";

function frame(u: number, v: number): Float32Array {
  const buf = new Float32Array(33 * 3);
  buf[LM.leftHip * 3] = u - 0.02; buf[LM.rightHip * 3] = u + 0.02;
  buf[LM.leftHip * 3 + 1] = v; buf[LM.rightHip * 3 + 1] = v;
  return buf;
}

test("imageToWorld: the frame is mpu metres wide, centred", () => {
  assert.deepEqual(imageToWorld(0.5, 0.5, 6, 16 / 9), { x: 0, y: 0 });
  assert.deepEqual(imageToWorld(1, 0, 6, 2), { x: 3, y: 1.5 });
});

test("videoAnchors: hips exact per frame, floor hipY below them, gaps borrowed", () => {
  const overlays = [frame(0.3, 0.5), null, frame(0.5, 0.5)];
  const a = videoAnchors(overlays, [4, 4, 4], [1, 1, 1], 2, 0);
  const near = (x: number, y: number) => assert.ok(Math.abs(x - y) < 1e-6, `${x} vs ${y}`);
  near(a[0].u, 0.3); near(a[1].u, 0.3); near(a[2].u, 0.5);
  // 1 m below the hips: the frame is 4 m wide and 2 m tall, so half its height.
  assert.ok(Math.abs(a[0].floorV - 1.0) < 1e-6);
  assert.equal(a[2].mpu, 4);
});

test("boxSmooth averages a window", () => {
  assert.deepEqual(Array.from(boxSmooth([0, 3, 0], 1)), [1.5, 1, 1.5]);
});
