/* ------------------------------------------------------------------
   Dance-along: how closely a live dancer matches a target dance.

   Both sides are snapped poses — the notation, not the smooth track —
   so "matching" means the same directions on the grid. Per core
   segment the credit is 1 within half a grid step of the target
   direction, 0 beyond a step and a half, linear between; a frame's
   score is the mean over the ten core segments. People run a little
   early or late, so a live frame is scored against the best target
   frame within a window around the same moment. Facing and travel are
   ignored: you may stand anywhere and turn as you like; the limbs must
   agree. By default the target is mirrored, the way you copy someone
   on a screen — their right is your left.

   Pure; no React. lib/live.ts feeds it, LiveBar shows it.
   ------------------------------------------------------------------ */

import { type AzEl, fromAzEl } from "./geometry";
import { mirrorPose } from "./devices";
import type { Pose } from "./pose";
import type { Score } from "./score";
import { BONES, type BoneId } from "./skeleton";

export const CORE_BONES: BoneId[] = BONES.filter((b) => b.core).map((b) => b.id);

/** Credit for one segment: 1 within half a `step`, 0 beyond a step and a half. */
export function directionCredit(a: AzEl, b: AzEl, step: number): number {
  const u = fromAzEl(a), v = fromAzEl(b);
  const cos = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z));
  const deg = (Math.acos(cos) * 180) / Math.PI;
  return Math.max(0, Math.min(1, 1.5 - deg / step));
}

export interface FrameMatch {
  /** Mean credit over the core segments, 0..1. */
  score: number;
  bones: Record<BoneId, number>;
  /** Seconds the best-matching target frame was from the live moment (positive = you were late). */
  lag: number;
}

export function matchPose(live: Pose, target: Pose, step: number): FrameMatch {
  const bones = {} as Record<BoneId, number>;
  let sum = 0;
  for (const id of CORE_BONES) { bones[id] = directionCredit(live.bones[id], target.bones[id], step); sum += bones[id]; }
  return { score: sum / CORE_BONES.length, bones, lag: 0 };
}

export interface MatchOptions {
  /** Grid step in degrees the credit is measured against. */
  step: number;
  /** Seconds either side of the live moment the target may be taken from. */
  window: number;
  /** Compare against the target's mirror image (copying someone on a screen). */
  mirror: boolean;
}

export const DEFAULT_MATCH: MatchOptions = { step: 22.5, window: 0.3, mirror: true };

/**
 * Score a live snapped pose at take time `t` against the target's snapped
 * frames near `t`: the best frame in the window counts. Null once the
 * target dance is over (beyond the window).
 */
export function matchAt(live: Pose, target: Score, t: number, opts: MatchOptions = DEFAULT_MATCH): FrameMatch | null {
  const fps = target.source.fps, n = target.frames.length;
  if (!n || t > target.source.duration + opts.window) return null;
  const centre = Math.round(t * fps), half = Math.round(opts.window * fps);
  let best: FrameMatch | null = null;
  for (let i = Math.max(0, centre - half); i <= Math.min(n - 1, centre + half); i++) {
    const frame = opts.mirror ? mirrorPose(target.frames[i]) : target.frames[i];
    const m = matchPose(live, frame, opts.step);
    m.lag = (centre - i) / fps;
    if (!best || m.score > best.score || (m.score === best.score && Math.abs(m.lag) < Math.abs(best.lag))) best = m;
  }
  return best;
}

export interface MatchSummary {
  /** Mean frame score, 0..1. */
  score: number;
  bones: Record<BoneId, number>;
  frames: number;
  /** Longest run of consecutive frames scoring at least `GOOD`, in seconds. */
  streak: number;
  /** Mean lag in seconds (positive = you ran late). */
  lag: number;
}

/** A frame at or above this is "in": it counts towards the streak. */
export const GOOD = 0.75;

/** Accumulates frame matches over a take. */
export class MatchTracker {
  private sum = 0;
  private boneSum = Object.fromEntries(CORE_BONES.map((id) => [id, 0])) as Record<BoneId, number>;
  private lagSum = 0;
  private n = 0;
  private run = 0;
  private runStart = 0;
  private best = 0;
  private lastT = 0;

  push(m: FrameMatch, t: number) {
    this.sum += m.score; this.lagSum += m.lag; this.n++;
    for (const id of CORE_BONES) this.boneSum[id] += m.bones[id];
    if (m.score >= GOOD) { if (this.run === 0) this.runStart = t; this.run++; this.best = Math.max(this.best, t - this.runStart); }
    else this.run = 0;
    this.lastT = t;
  }

  get frames() { return this.n; }

  summary(): MatchSummary {
    const n = Math.max(1, this.n);
    const bones = {} as Record<BoneId, number>;
    for (const id of CORE_BONES) bones[id] = this.boneSum[id] / n;
    return { score: this.n ? this.sum / n : 0, bones, frames: this.n, streak: Math.round(this.best * 100) / 100, lag: this.n ? this.lagSum / n : 0 };
  }
}

/** A word for a score, for the bar and the report. */
export function grade(score: number): string {
  if (score >= 0.9) return "Perfect";
  if (score >= 0.75) return "Great";
  if (score >= 0.55) return "Good";
  if (score >= 0.35) return "Getting there";
  return "Keep going";
}
