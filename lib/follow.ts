/* ------------------------------------------------------------------
   Follow: keep to one person when the frame holds several.

   The tracker detects everyone in the frame; this module decides which
   detection is *the dancer* on every frame. A person is summarised by an
   Anchor — where their hips are and how big they look — and identity is
   carried frame to frame by nearest anchor, with a jump limit scaled by
   body size so a bystander standing still doesn't steal the track when
   the dancer is briefly missed.

   All coordinates are fractions of the tracked frame (the crop, when
   there is one). Nothing here touches MediaPipe or the DOM.
   ------------------------------------------------------------------ */

import { LM } from "./skeleton";

/** Where a person is and how big they look, in fractions of the frame. */
export interface Anchor {
  x: number;
  y: number;
  /** Longer side of the visible-landmark box; the scale every distance is measured against. */
  size: number;
  /** Bounding box of the visible landmarks. */
  box: { x: number; y: number; w: number; h: number };
}

/** A point in the clip the user tapped to say "this one", as fractions of the *full* video frame. */
export interface PersonPick {
  x: number;
  y: number;
  /** Seconds into the clip. */
  t: number;
}

const MIN_VIS = 0.5;

/**
 * Summarise a pose buffer (x, y, visibility triples, as the tracker emits).
 * Null when too little of the body is visible to say where it is.
 */
export function anchorOf(buf: ArrayLike<number>, minVis = MIN_VIS): Anchor | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0, sx = 0, sy = 0;
  for (let i = 0; i + 2 < buf.length; i += 3) {
    if (buf[i + 2] < minVis) continue;
    const px = buf[i], py = buf[i + 1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    sx += px; sy += py; n++;
  }
  if (n < 4) return null;
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const size = Math.max(box.w, box.h, 1e-3);
  // Hips when both are visible, else the centroid of what is.
  const lh = LM.leftHip * 3, rh = LM.rightHip * 3;
  const hips = buf[lh + 2] >= minVis && buf[rh + 2] >= minVis;
  const x = hips ? (buf[lh] + buf[rh]) / 2 : sx / n;
  const y = hips ? (buf[lh + 1] + buf[rh + 1]) / 2 : sy / n;
  return { x, y, size, box };
}

/**
 * Which anchor a tap lands on: inside a box (padded a little, since
 * people tap torsos, not landmarks) and nearest by hips among those;
 * otherwise the nearest hips within `reach` of the point. -1 when none.
 */
export function pickAnchor(anchors: (Anchor | null)[], p: { x: number; y: number }, reach = 0.12): number {
  const dist = (a: Anchor) => Math.hypot(a.x - p.x, a.y - p.y);
  const inside = (a: Anchor) => {
    const pad = a.size * 0.15;
    return p.x >= a.box.x - pad && p.x <= a.box.x + a.box.w + pad && p.y >= a.box.y - pad && p.y <= a.box.y + a.box.h + pad;
  };
  const nearest = (ok: (a: Anchor) => boolean) => {
    let best = -1, bestD = Infinity;
    anchors.forEach((a, i) => { if (a && ok(a) && dist(a) < bestD) { bestD = dist(a); best = i; } });
    return best;
  };
  const hit = nearest(inside);
  return hit >= 0 ? hit : nearest((a) => dist(a) <= reach);
}

/**
 * Drop detections that are the same person twice (the detector sometimes
 * boxes a body two ways): a later anchor within a quarter of a body of an
 * earlier one, at a similar size, is a duplicate. Returns indices to keep.
 */
export function dedupeAnchors(anchors: (Anchor | null)[]): number[] {
  const keep: number[] = [];
  anchors.forEach((a, i) => {
    if (!a) return;
    const dup = keep.some((k) => {
      const b = anchors[k]!;
      const ratio = a.size / b.size;
      return Math.hypot(a.x - b.x, a.y - b.y) < 0.25 * Math.max(a.size, b.size) && ratio > 0.6 && ratio < 1.7;
    });
    if (!dup) keep.push(i);
  });
  return keep;
}

/** The biggest body in the frame (what a single-person tracker would settle on). -1 when empty. */
export function largestAnchor(anchors: (Anchor | null)[]): number {
  let best = -1, size = 0;
  anchors.forEach((a, i) => { if (a && a.size > size) { size = a.size; best = i; } });
  return best;
}

/** How far the followed person may move between consecutive frames, as a multiple of their size. */
export const MAX_JUMP = 0.6;
/** Extra reach per frame the person has been missing, so they can be found again after an occlusion. */
export const JUMP_GROWTH = 0.12;
/** Farthest the reach ever grows, as a multiple of size, so a lost dancer never adopts someone across the room. */
export const MAX_REACH = 1.2;

/**
 * Which candidate continues `last` after `gap` frames without a sighting.
 * Nearest by hips within the reach, penalised by a change in size (someone
 * twice as big is almost certainly someone else). -1 when nobody fits.
 */
export function nextAnchor(anchors: (Anchor | null)[], last: Anchor, gap = 0): number {
  const reach = Math.min(MAX_REACH, MAX_JUMP + JUMP_GROWTH * gap) * last.size + 0.01;
  let best = -1, bestCost = Infinity;
  anchors.forEach((a, i) => {
    if (!a) return;
    const d = Math.hypot(a.x - last.x, a.y - last.y);
    if (d > reach) return;
    const ratio = a.size / last.size;
    if (ratio < 0.4 || ratio > 2.5) return;
    const cost = d / last.size + Math.abs(Math.log(ratio)) * 0.5;
    if (cost < bestCost) { bestCost = cost; best = i; }
  });
  return best;
}

/**
 * Assign one candidate per frame to the person chosen at `start`, walking
 * forward and backward from there and carrying their last known anchor
 * across frames where nobody matched. Returns the chosen index per frame,
 * -1 where the person was not seen.
 *
 * With `reseedAfter`, once the person has been missing that many frames
 * the biggest body in view is adopted instead (forward only) — right for
 * "the main person" with no pick, since a solo dancer who leaves the frame
 * and returns elsewhere is still the dancer; wrong for a deliberate pick,
 * which must never drift onto a bystander.
 */
export function followPerson(frames: (Anchor | null)[][], start: { frame: number; index: number }, opts: { reseedAfter?: number } = {}): number[] {
  const out = new Array<number>(frames.length).fill(-1);
  if (!frames.length) return out;
  const origin = frames[start.frame]?.[start.index];
  if (!origin) return out;
  out[start.frame] = start.index;
  const walk = (step: 1 | -1) => {
    let last = origin, gap = 0;
    for (let f = start.frame + step; f >= 0 && f < frames.length; f += step) {
      let i = nextAnchor(frames[f], last, gap);
      if (i < 0 && step > 0 && opts.reseedAfter !== undefined && gap >= opts.reseedAfter) i = largestAnchor(frames[f]);
      out[f] = i;
      if (i >= 0) { last = frames[f][i]!; gap = 0; } else gap++;
    }
  };
  walk(1);
  walk(-1);
  return out;
}

/**
 * Find the person a pick refers to: the candidate under the tapped point on
 * the frame nearest the tapped time, or failing that on the nearest frames
 * within `window` of it (the detector may have missed them on that exact
 * frame). Null when no one was there.
 */
export function locatePick(frames: (Anchor | null)[][], pick: { x: number; y: number }, frame: number, window = 8): { frame: number; index: number } | null {
  for (let d = 0; d <= window; d++) {
    for (const f of d === 0 ? [frame] : [frame - d, frame + d]) {
      if (f < 0 || f >= frames.length) continue;
      const i = pickAnchor(frames[f], pick);
      if (i >= 0) return { frame: f, index: i };
    }
  }
  return null;
}

/**
 * The same identity rule, one frame at a time, for a live camera: the
 * nearest continuation of the person we had, and — with nobody to continue
 * or the person gone for `reseedAfter` frames — the biggest body in view.
 */
export class LiveFollower {
  private last: Anchor | null = null;
  private gap = 0;
  constructor(private reseedAfter: number) {}
  /** Index of the dancer among this frame's anchors, -1 when not seen. */
  pick(anchors: (Anchor | null)[]): number {
    let k = this.last ? nextAnchor(anchors, this.last, this.gap) : -1;
    if (k < 0 && (!this.last || this.gap >= this.reseedAfter)) k = largestAnchor(anchors);
    if (k >= 0) { this.last = anchors[k]; this.gap = 0; } else this.gap++;
    return k;
  }
}
