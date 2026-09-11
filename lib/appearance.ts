/* ------------------------------------------------------------------
   Appearance: what a person is wearing, as a colour signature.

   Position alone cannot tell two dancers apart once they cross; their
   clothes usually can. The signature is a coarse colour histogram of
   the torso — shoulders to hips, the patch least likely to be a limb of
   someone else or the background — taken from a small copy of the frame
   the tracker already has. Pure pixels in, numbers out; see ./follow
   for how the distance between two signatures enters the matching.
   ------------------------------------------------------------------ */

import { LM } from "./skeleton";

/** Bins per channel; 4³ = 64 bins is coarse enough to shrug off lighting and fine enough to tell a red top from a blue one. */
const LEVELS = 4;
export const SIG_BINS = LEVELS * LEVELS * LEVELS;
/** Fewer sampled pixels than this and the patch is too small to mean anything. */
const MIN_PIXELS = 12;
/** How much of the torso box is sampled, centred, so the edges (skin, background) stay out. */
const INSET = 0.2;

/**
 * The torso's colour signature from an RGBA pixel buffer `w`×`h` and the
 * person's image landmarks (x, y, visibility triples, fractions of that
 * same frame). Null when the torso is not visible or too small.
 */
export function torsoSignature(pixels: Uint8ClampedArray, w: number, h: number, lm: ArrayLike<number>, minVis = 0.5): Float32Array | null {
  const ids = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of ids) {
    if (lm[i * 3 + 2] < minVis) return null;
    const x = lm[i * 3], y = lm[i * 3 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const bw = x1 - x0, bh = y1 - y0;
  const px0 = Math.max(0, Math.floor((x0 + bw * INSET) * w)), px1 = Math.min(w, Math.ceil((x1 - bw * INSET) * w));
  const py0 = Math.max(0, Math.floor((y0 + bh * INSET) * h)), py1 = Math.min(h, Math.ceil((y1 - bh * INSET) * h));
  if (px1 - px0 < 1 || py1 - py0 < 1) return null;
  const sig = new Float32Array(SIG_BINS);
  let n = 0;
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      const k = (y * w + x) * 4;
      const r = (pixels[k] * LEVELS) >> 8, g = (pixels[k + 1] * LEVELS) >> 8, b = (pixels[k + 2] * LEVELS) >> 8;
      sig[(r * LEVELS + g) * LEVELS + b]++;
      n++;
    }
  }
  if (n < MIN_PIXELS) return null;
  for (let i = 0; i < SIG_BINS; i++) sig[i] /= n;
  return sig;
}
