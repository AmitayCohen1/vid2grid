import test from "node:test";
import assert from "node:assert/strict";
import { FULL_CROP, MIN_CROP, clampCrop, cropPixels, cropZoom, fitCropToPoints, isCrop, isFullCrop, moveCrop, resizeCrop, zoomCrop } from "../lib/crop";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("clampCrop keeps the box inside the frame and above the minimum size", () => {
  assert.deepEqual(clampCrop({ x: 0.9, y: -0.2, w: 0.5, h: 0.05 }), { x: 0.5, y: 0, w: 0.5, h: MIN_CROP });
  assert.deepEqual(clampCrop({ x: 0, y: 0, w: 3, h: 3 }), FULL_CROP);
});

test("zoomCrop keeps the frame aspect and the anchor in place", () => {
  const z = zoomCrop(FULL_CROP, 2, { x: 0.5, y: 0.5 });
  assert.deepEqual(z, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  close(cropZoom(z), 2);
  // Anchored at the pointer: the point under it stays at the same fraction of the box.
  const a = { x: 0.8, y: 0.3 };
  const z2 = zoomCrop(z, 4, a);
  close((a.x - z2.x) / z2.w, (a.x - z.x) / z.w);
  close((a.y - z2.y) / z2.h, (a.y - z.y) / z.h);
  // Zooming out past the frame is the full frame.
  assert.deepEqual(zoomCrop(z, 0.5), FULL_CROP);
  assert.ok(isFullCrop(zoomCrop(z, 1)));
});

test("moveCrop and resizeCrop respect the frame edges", () => {
  const c = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  assert.deepEqual(moveCrop(c, 1, -1), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
  const east = resizeCrop(c, "e", 0.1, 0);
  assert.deepEqual(east, { x: 0.25, y: 0.25, w: 0.6, h: 0.5 });
  const nw = resizeCrop(c, "nw", -0.1, -0.1);
  close(nw.x, 0.15); close(nw.y, 0.15); close(nw.w, 0.6); close(nw.h, 0.6);
  // Pulling the west edge past the east one stops at the minimum width, right edge fixed.
  const squeezed = resizeCrop(c, "w", 5, 0);
  close(squeezed.x + squeezed.w, 0.75); close(squeezed.w, MIN_CROP);
});

test("fitCropToPoints pads a box around the visible landmarks", () => {
  // A standing figure: x 0.4..0.5, y 0.2..0.8, plus an invisible outlier that must be ignored.
  const pts = [0.4, 0.2, 0.9, 0.5, 0.8, 0.9, 0.45, 0.5, 0.95, 0.0, 0.0, 0.1];
  const c = fitCropToPoints(pts, 0.2)!;
  const pad = 0.6 * 0.2;
  close(c.x, 0.4 - pad); close(c.y, 0.2 - pad); close(c.w, 0.1 + 2 * pad); close(c.h, 0.6 + 2 * pad);
  assert.equal(fitCropToPoints([0.5, 0.5, 0.9]), null);
  assert.equal(fitCropToPoints([]), null);
});

test("cropPixels and isCrop", () => {
  assert.deepEqual(cropPixels({ x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, 1920, 1080), { x: 480, y: 108, w: 960, h: 864 });
  assert.ok(isCrop({ x: 0, y: 0, w: 1, h: 1 }));
  assert.ok(!isCrop({ x: 0.5, y: 0, w: 0.6, h: 1 }));
  assert.ok(!isCrop({ x: 0, y: 0, w: 0, h: 1 }));
  assert.ok(!isCrop(null));
});
