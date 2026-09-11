/* ------------------------------------------------------------------
   Follow: keep to the same people when the frame holds several.

   The tracker detects everyone in the frame; this module decides which
   detection is which dancer on every frame. A person is summarised by
   an Anchor — where their hips are, how big they look and, when the
   tracker sampled it, the colour of their clothes — and identity is
   carried frame to frame by the cheapest continuation: near where they
   were heading, about the same size, dressed the same. With several
   dancers the frame is assigned jointly, so two of them can never be
   the same body, and a jump limit scaled by body size keeps a bystander
   standing still from stealing a track when a dancer is briefly missed.

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
  /** Colour signature of the torso (see ./appearance), when the tracker sampled one. */
  sig?: Float32Array;
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
/** How much of last frame's motion is expected to continue, and the farthest that carries, as a multiple of size. */
const MOMENTUM = 0.6, MAX_LEAD = 0.5;
/** Weight of the clothes: a wholly different colour costs this much, about a body-length of distance. */
const APPEARANCE = 1.0;
/** Cost of leaving a track unmatched on a frame — above any in-reach match, so a body is only given up to someone who fits better. */
const MISS = 3;

/** A person being followed: where they were, where they were before that, and what they wear on average. */
export interface Track {
  last: Anchor;
  prev: Anchor | null;
  /** Frames since they were last seen. */
  gap: number;
  /** Running mean of the signatures matched so far. */
  sig: Float32Array | null;
}

/** Where a track is expected next: a little of its last motion carried on, when it was seen on consecutive frames. */
export function expected(t: Track): { x: number; y: number } {
  if (!t.prev || t.gap > 0) return t.last;
  let dx = (t.last.x - t.prev.x) * MOMENTUM, dy = (t.last.y - t.prev.y) * MOMENTUM;
  const d = Math.hypot(dx, dy), cap = MAX_LEAD * t.last.size;
  if (d > cap) { dx *= cap / d; dy *= cap / d; }
  return { x: t.last.x + dx, y: t.last.y + dy };
}

/** Histogram intersection distance, 0 (same) .. 1 (nothing in common). */
export function sigDistance(a: Float32Array, b: Float32Array): number {
  let common = 0;
  for (let i = 0; i < a.length && i < b.length; i++) common += Math.min(a[i], b[i]);
  return 1 - common;
}

/**
 * How badly `a` continues the track: distance from where it was heading in
 * body sizes, a change in size (someone twice as big is almost certainly
 * someone else) and, when both wear a signature, a change of clothes.
 * Infinity when out of reach — and the reach grows with every frame missed.
 */
export function trackCost(t: Track, a: Anchor): number {
  const reach = Math.min(MAX_REACH, MAX_JUMP + JUMP_GROWTH * t.gap) * t.last.size + 0.01;
  const e = expected(t);
  const d = Math.hypot(a.x - e.x, a.y - e.y);
  if (d > reach) return Infinity;
  const ratio = a.size / t.last.size;
  if (ratio < 0.4 || ratio > 2.5) return Infinity;
  let cost = d / t.last.size + Math.abs(Math.log(ratio)) * 0.5;
  if (t.sig && a.sig) cost += APPEARANCE * sigDistance(t.sig, a.sig);
  return cost;
}

/**
 * Which candidate continues `last` after `gap` frames without a sighting.
 * -1 when nobody fits. (One track, no history: what the live follower uses.)
 */
export function nextAnchor(anchors: (Anchor | null)[], last: Anchor, gap = 0): number {
  return assign([{ last, prev: null, gap, sig: last.sig ?? null }], anchors)[0];
}

/**
 * Give each track at most one candidate, and each candidate at most one
 * track, at the least total cost — a track goes unmatched only when every
 * body in reach is a better fit for someone else. Small enough (≤ 4 of
 * each) to try every assignment.
 */
export function assign(tracks: Track[], anchors: (Anchor | null)[], taken: boolean[] = []): number[] {
  const costs = tracks.map((t) => anchors.map((a, i) => (a && !taken[i] ? trackCost(t, a) : Infinity)));
  const best = new Array<number>(tracks.length).fill(-1);
  let bestTotal = Infinity;
  const pick = new Array<number>(tracks.length).fill(-1);
  const used = new Array<boolean>(anchors.length).fill(false);
  const walk = (k: number, total: number) => {
    if (total >= bestTotal) return;
    if (k === tracks.length) { bestTotal = total; best.splice(0, best.length, ...pick); return; }
    costs[k].forEach((c, i) => {
      if (!Number.isFinite(c) || used[i]) return;
      used[i] = true; pick[k] = i;
      walk(k + 1, total + c);
      used[i] = false;
    });
    pick[k] = -1;
    walk(k + 1, total + MISS);
  };
  walk(0, 0);
  return best;
}

/** Fold a matched signature into a track's running mean. */
function learn(t: Track, a: Anchor): Float32Array | null {
  if (!a.sig) return t.sig;
  if (!t.sig) return Float32Array.from(a.sig);
  const out = new Float32Array(t.sig.length);
  for (let i = 0; i < out.length; i++) out[i] = t.sig[i] * 0.9 + a.sig[i] * 0.1;
  return out;
}

/** Where each of several dancers was picked: a frame and the candidate on it. */
export interface Seed { frame: number; index: number }

/**
 * Follow several people at once through every frame. Each seed is one
 * dancer, fixed to that candidate on that frame; from there the dancer
 * is walked forward to the end and backward to the start, with every
 * frame assigned jointly so no two dancers are ever the same body.
 * Returns, per seed, the chosen candidate index per frame (-1 when not
 * seen).
 *
 * Going backward, a dancer whose seed is later than the frame keeps the
 * body the forward walk gave them there, so a dancer picked late in the
 * clip cannot take a body that already belongs to someone.
 *
 * With `reseedAfter`, a dancer missing that many frames adopts the
 * biggest unclaimed body in view instead (forward only) — right for "the
 * main person" with no pick, since a solo dancer who leaves the frame and
 * returns elsewhere is still the dancer; wrong for a deliberate pick,
 * which must never drift onto a bystander.
 */
export function followPeople(frames: (Anchor | null)[][], seeds: Seed[], opts: { reseedAfter?: number } = {}): number[][] {
  const n = frames.length;
  const out = seeds.map(() => new Array<number>(n).fill(-1));
  if (!n || !seeds.length) return out;
  const valid = seeds.map((s) => !!frames[s.frame]?.[s.index]);
  const walk = (step: 1 | -1, pinned: number[][] | null) => {
    const tracks = new Map<number, Track>();
    const from = step > 0 ? 0 : n - 1;
    for (let f = from; f >= 0 && f < n; f += step) {
      const taken: boolean[] = [];
      // Bodies already spoken for: seeds on this very frame, and (walking back) forward results of later seeds.
      const forced = new Map<number, number>();
      seeds.forEach((s, k) => {
        if (!valid[k]) return;
        if (s.frame === f) { forced.set(k, s.index); taken[s.index] = true; }
        else if (pinned && (step > 0 ? s.frame > f : s.frame < f)) { const i = pinned[k][f]; if (i >= 0) taken[i] = true; }
      });
      const active = [...tracks.keys()].filter((k) => !forced.has(k));
      const chosen = assign(active.map((k) => tracks.get(k)!), frames[f], taken);
      active.forEach((k, j) => {
        const t = tracks.get(k)!;
        let i = chosen[j];
        if (i < 0 && step > 0 && opts.reseedAfter !== undefined && t.gap >= opts.reseedAfter) {
          i = largestAnchor(frames[f].map((a, q) => (taken[q] || chosen.includes(q) ? null : a)));
        }
        out[k][f] = i;
        if (i >= 0) { const a = frames[f][i]!; tracks.set(k, { last: a, prev: t.gap ? null : t.last, gap: 0, sig: learn(t, a) }); }
        else t.gap++;
      });
      forced.forEach((i, k) => {
        const a = frames[f][i]!;
        out[k][f] = i;
        tracks.set(k, { last: a, prev: null, gap: 0, sig: a.sig ? Float32Array.from(a.sig) : null });
      });
    }
  };
  // Forward first, then backward with the forward results pinned for seeds the backward walk hasn't reached.
  walk(1, null);
  const forward = out.map((o) => o.slice());
  walk(-1, forward);
  // Each frame belongs to the walk that started from the seed's side of it.
  seeds.forEach((s, k) => { for (let f = s.frame; f < n; f++) out[k][f] = forward[k][f]; });
  return out;
}

/**
 * Assign one candidate per frame to the person chosen at `start`, walking
 * forward and backward from there. Returns the chosen index per frame,
 * -1 where the person was not seen. See `followPeople` for `reseedAfter`.
 */
export function followPerson(frames: (Anchor | null)[][], start: Seed, opts: { reseedAfter?: number } = {}): number[] {
  return followPeople(frames, [start], opts)[0];
}

/**
 * Find the person a pick refers to: the candidate under the tapped point on
 * the frame nearest the tapped time, or failing that on the nearest frames
 * within `window` of it (the detector may have missed them on that exact
 * frame). Null when no one was there.
 */
export function locatePick(frames: (Anchor | null)[][], pick: { x: number; y: number }, frame: number, window = 8): Seed | null {
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
