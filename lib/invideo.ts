/* ------------------------------------------------------------------
   Figures inside the video.

   The tracker's 2D landmarks say exactly where the person is in the
   frame, and `metresPerUnit` says how many metres the frame spans at
   their depth. That is enough to draw a figure *in* the picture at the
   person's scale: an orthographic camera whose width is metresPerUnit
   metres, with the figure's hips beside the person's and its feet on
   the person's floor. No camera calibration, nothing guessed.
   ------------------------------------------------------------------ */

import { LM } from "./skeleton";

export interface VideoAnchor {
  /** The person's hip midpoint across the frame, 0..1 (exact, per frame). */
  u: number;
  /** Where the person's floor is, as a fraction of the frame height (smoothed). */
  floorV: number;
  /** Metres the frame spans at the person's depth (smoothed). */
  mpu: number;
}

/** Box-average a series over ±radius samples. */
export function boxSmooth(xs: ArrayLike<number>, radius: number): Float32Array {
  const n = xs.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) { s += xs[j]; c++; }
    }
    out[i] = c ? s / c : xs[i];
  }
  return out;
}

/**
 * One anchor per frame. `overlays` are the tracker's image landmarks
 * (x, y, visibility triples), `mpus` the per-frame metres-per-unit, and
 * `hipYs` the hip height above the lowest foot in metres (from the
 * pose), which puts the floor `hipY` metres below the hips in the
 * picture. `aspect` is the frame's width / height. Frames where nobody
 * was seen borrow the nearest seen frame, like the poses do.
 */
export function videoAnchors(
  overlays: (Float32Array | null)[],
  mpus: ArrayLike<number>,
  hipYs: ArrayLike<number>,
  aspect: number,
  radius = 15,
): VideoAnchor[] {
  const n = overlays.length;
  const u = new Float32Array(n), v = new Float32Array(n);
  const first = overlays.findIndex(Boolean);
  let last = first >= 0 ? overlays[first]! : null;
  for (let i = 0; i < n; i++) {
    const buf = overlays[i] ?? last;
    if (!buf) continue;
    last = buf;
    u[i] = (buf[LM.leftHip * 3] + buf[LM.rightHip * 3]) / 2;
    v[i] = (buf[LM.leftHip * 3 + 1] + buf[LM.rightHip * 3 + 1]) / 2;
  }
  const floor = new Float32Array(n);
  for (let i = 0; i < n; i++) floor[i] = v[i] + (hipYs[i] * aspect) / Math.max(1e-3, mpus[i]);
  // Smooth the scale and the floor (a jump must not lift the floor), never the position.
  const floorS = boxSmooth(floor, radius), mpuS = boxSmooth(mpus, radius);
  return Array.from({ length: n }, (_, i) => ({ u: u[i], floorV: floorS[i], mpu: mpuS[i] }));
}

/** Image fraction (u across, v down) → metres in the picture, origin at its centre. */
export function imageToWorld(u: number, v: number, mpu: number, aspect: number): { x: number; y: number } {
  return { x: (u - 0.5) * mpu, y: (0.5 - v) * (mpu / aspect) };
}
