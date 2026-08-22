/* ------------------------------------------------------------------
   Sections: up to 8 beats of quantized keyframes in the shared
   movement-languages format. The vanilla twin of the schema lives in
   public/movement-languages/section-store.js — keep them in step.
   ------------------------------------------------------------------ */

import type { AzEl } from "./geometry";
import { fromAzEl } from "./geometry";
import type { Pose } from "./pose";
import { type Score, frameAt } from "./score";

export const SECTION_BONE_IDS = [
  "torso", "head", "ruarm", "rfarm", "luarm", "lfarm",
  "rthigh", "rshin", "lthigh", "lshin",
] as const;
export type SectionBoneId = (typeof SECTION_BONE_IDS)[number];

export interface SectionPose {
  x: number; z: number; facing: number; hipY: number;
  bones: Record<SectionBoneId, AzEl>;
}
export interface SectionKey { beat: number; pose: SectionPose }
export interface Section {
  v: 1; id: string; name: string; createdAt: number;
  tempo: number; beats: number;
  source: { file: string; startSec: number; endSec: number };
  keys: SectionKey[];
}
export interface Choreography {
  v: 1; id: string; name: string; tempo: number;
  items: { sectionId: string; repeat: number }[];
}

export const wrap180 = (a: number): number => ((a % 360) + 540) % 360 - 180;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function poseToSectionPose(p: Pose): SectionPose {
  const bones = {} as Record<SectionBoneId, AzEl>;
  for (const id of SECTION_BONE_IDS) {
    const [az, el] = p.bones[id];
    bones[id] = [r2(wrap180(az)), r2(el)];
  }
  return { x: r2(p.x), z: r2(p.z), facing: r2(wrap180(p.facing)), hipY: r2(p.hipY), bones };
}

const isQuarter = (b: number) => Number.isFinite(b) && Math.round(b * 4) === b * 4;

export function validateSection(o: unknown): Section {
  const s = o as Section;
  if (!s || typeof s !== "object") throw new Error("not an object");
  if (s.v !== 1) throw new Error("unsupported section version");
  if (typeof s.id !== "string" || !s.id) throw new Error("missing id");
  if (typeof s.name !== "string") throw new Error("missing name");
  if (typeof s.createdAt !== "number") throw new Error("missing createdAt");
  if (!Number.isInteger(s.beats) || s.beats < 1 || s.beats > 8) throw new Error("beats must be an integer 1–8");
  if (typeof s.tempo !== "number" || s.tempo <= 0) throw new Error("bad tempo");
  if (!s.source || typeof s.source !== "object" || typeof s.source.file !== "string" ||
      typeof s.source.startSec !== "number" || typeof s.source.endSec !== "number")
    throw new Error("bad source (need file, startSec, endSec)");
  if (!Array.isArray(s.keys) || !s.keys.length) throw new Error("a key at beat 0 is required");
  for (const k of s.keys) {
    if (!isQuarter(k.beat) || k.beat < 0 || k.beat >= s.beats) throw new Error("key beats must be quarter multiples in [0, beats)");
    if (!k.pose || typeof k.pose !== "object" || !k.pose.bones) throw new Error("key missing pose");
    for (const id of SECTION_BONE_IDS) {
      const b = k.pose.bones[id];
      if (!Array.isArray(b) || b.length !== 2 || typeof b[0] !== "number" || typeof b[1] !== "number")
        throw new Error(`pose missing bone ${id}`);
    }
    for (const f of ["x", "z", "facing", "hipY"] as const)
      if (typeof k.pose[f] !== "number") throw new Error(`pose missing ${f}`);
  }
  if (s.keys[0].beat !== 0) throw new Error("a key at beat 0 is required");
  return s;
}

export interface QuantizeOptions {
  bpm: number; offsetSec: number; startBeat: number; lengthBeats: number;
}

/** Total angular movement (deg) of the ten section bones between two frames. */
function changeMagnitude(score: Score, fi: number): number {
  if (fi <= 0) return Infinity;
  const a = score.frames[fi - 1], b = score.frames[fi];
  let sum = 0;
  for (const id of SECTION_BONE_IDS) {
    const va = fromAzEl(a.bones[id]), vb = fromAzEl(b.bones[id]);
    const d = Math.max(-1, Math.min(1, va.x * vb.x + va.y * vb.y + va.z * vb.z));
    sum += (Math.acos(d) * 180) / Math.PI;
  }
  return sum;
}

const snapQuarter = (b: number) => Math.round(b * 4) / 4;

export function quantizeKeys(score: Score, opts: QuantizeOptions): { keys: SectionKey[]; srcFrames: number[] } {
  const { bpm, offsetSec, startBeat, lengthBeats } = opts;
  const toBeat = (t: number) => ((t - offsetSec) * bpm) / 60 - startBeat;
  // beat (quarter-multiple) → winning frame index
  const byBeat = new Map<number, number>();
  for (const fi of score.keyframes) {
    const b = snapQuarter(toBeat(score.frames[fi].t));
    if (b < 0 || b >= lengthBeats) continue;
    const cur = byBeat.get(b);
    if (cur === undefined || changeMagnitude(score, fi) > changeMagnitude(score, cur)) byBeat.set(b, fi);
  }
  if (!byBeat.has(0)) byBeat.set(0, frameAt(score, offsetSec + (startBeat * 60) / bpm));
  const beats = [...byBeat.keys()].sort((a, b) => a - b);
  return {
    keys: beats.map((b) => ({ beat: b, pose: poseToSectionPose(score.frames[byBeat.get(b)!]) })),
    srcFrames: beats.map((b) => byBeat.get(b)!),
  };
}

export function makeSection(score: Score, opts: QuantizeOptions, name: string): Section {
  const { keys } = quantizeKeys(score, opts);
  const startSec = opts.offsetSec + (opts.startBeat * 60) / opts.bpm;
  return validateSection({
    v: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    tempo: Math.round(opts.bpm * 100) / 100,
    beats: opts.lengthBeats,
    source: { file: score.source.name, startSec, endSec: startSec + (opts.lengthBeats * 60) / opts.bpm },
    keys,
  });
}
