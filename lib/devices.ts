/* ------------------------------------------------------------------
   Choreographic devices: what a cast member does with its clip.

   A member's clip is never edited — a device is a view of it, sampled
   at draw time from the same snapped (or smooth) track the stage uses:

     delay    the member waits, holding the clip's first pose, then starts
     rate     the clip runs faster (>1) or slower (<1)
     reverse  the clip runs backwards (retrograde)
     mirror   left and right are swapped (the audience's mirror image)

   A canon is just several copies with staggered delays.
   ------------------------------------------------------------------ */

import { type AzEl, fromAzEl, toAzEl, wrap360 } from "./geometry";
import type { Body } from "./fk";
import type { Pose } from "./pose";
import { BONE_IDS, type BoneId } from "./skeleton";

export interface Devices {
  /** Seconds of stage time before the clip starts. */
  delay: number;
  /** Clip seconds per stage second: 2 = twice as fast. */
  rate: number;
  mirror: boolean;
  reverse: boolean;
  /** Scale of the figure: 1 = the tracked body, 2 = twice as tall. Display only — the score keeps the real body. */
  size: number;
}

export const NO_DEVICES: Devices = { delay: 0, rate: 1, mirror: false, reverse: false, size: 1 };
export const MIN_SIZE = 0.5, MAX_SIZE = 2;

/** Round a stored value into a usable Devices — missing or bad fields fall back. */
export function sanitizeDevices(d: Partial<Devices> | null | undefined): Devices {
  const num = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  return {
    delay: num(d?.delay, 0, 60, 0),
    rate: num(d?.rate, 0.1, 4, 1),
    mirror: d?.mirror === true,
    reverse: d?.reverse === true,
    size: num(d?.size, MIN_SIZE, MAX_SIZE, 1),
  };
}

/** Stage seconds the member occupies: the wait, then the stretched clip. */
export function memberSpan(duration: number, d: Devices): number {
  return d.delay + duration / Math.max(1e-3, d.rate);
}

/**
 * Clip time for a stage time. Before the delay the member holds the
 * clip's first pose (its last, when reversed); after the clip ends it
 * holds the final one — the stage clock may outlast it.
 */
export function clipTime(stageT: number, duration: number, d: Devices): number {
  let t = (stageT - d.delay) * d.rate;
  t = Math.max(0, Math.min(duration, t));
  return d.reverse ? duration - t : t;
}

const MIRROR: Record<BoneId, BoneId> = {
  torso: "torso", shoulders: "shoulders", head: "head",
  ruarm: "luarm", rfarm: "lfarm", rhand: "lhand",
  luarm: "ruarm", lfarm: "rfarm", lhand: "rhand",
  rthigh: "lthigh", rshin: "lshin", rfoot: "lfoot",
  lthigh: "rthigh", lshin: "rshin", lfoot: "rfoot",
};

/**
 * The audience's mirror image of a pose: stage x flips, so the dancer
 * faces −φ, each limb takes its opposite's direction with body-local x
 * negated, and the shoulder line (left→right) reverses on top of that.
 */
export function mirrorPose(p: Pose): Pose {
  const bones = {} as Record<BoneId, AzEl>;
  for (const id of BONE_IDS) {
    const d = fromAzEl(p.bones[MIRROR[id]]);
    bones[id] = id === "shoulders" ? toAzEl({ x: d.x, y: -d.y, z: -d.z }) : toAzEl({ x: -d.x, y: d.y, z: d.z });
  }
  return { ...p, bones, facing: wrap360(-p.facing), x: -p.x };
}

/** A body `s` times the size: every bone, and the hip and shoulder widths. */
export function scaleBody(b: Body, s: number): Body {
  if (s === 1) return b;
  const lengths = {} as Record<BoneId, number>;
  for (const id of BONE_IDS) lengths[id] = b.lengths[id] * s;
  return { lengths, hipWidth: b.hipWidth * s, shoulderWidth: b.shoulderWidth * s };
}

/** The pose that goes with a scaled body: the hips ride `s` times as high, so the feet stay on the floor. Travel is unchanged. */
export function scalePose(p: Pose, s: number): Pose {
  return s === 1 ? p : { ...p, hipY: p.hipY * s };
}

export function mirrorBody(b: Body): Body {
  const lengths = {} as Record<BoneId, number>;
  for (const id of BONE_IDS) lengths[id] = b.lengths[MIRROR[id]];
  return { ...b, lengths };
}

/**
 * Bake a floor placement into a pose: yaw the facing by `rot` degrees,
 * turn the tracked travel with it, then shift by (x, z) metres. The
 * avatar retargeter works in absolute stage directions, so placement
 * must live in the pose, not in a parent transform.
 */
export function placePose(p: Pose, place: { x: number; z: number; rot: number }): Pose {
  const rad = (place.rot * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { ...p, facing: p.facing + place.rot, x: p.x * cos + p.z * sin + place.x, z: p.z * cos - p.x * sin + place.z };
}
