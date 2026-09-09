/* ------------------------------------------------------------------
   The Score: what vid2grid produces.

   raw     — smoothed but continuous poses, one per sampled frame (evidence)
   frames  — the same poses snapped to the grid (truth)
   keyframes — frame indices where the notation changes
   ------------------------------------------------------------------ */

import { type Cell, DEFAULT_GRID, type GridConfig, cellToAzEl, sameCell, snapAngle, snapCell } from "./grid";
import { OneEuro, OneEuro3, median } from "./filter";
import { type AzEl, fromAzEl, toAzEl } from "./geometry";
import type { Body } from "./fk";
import type { Extraction, Pose } from "./pose";
import { bodyFromEdges, liftClip } from "./lift";
import { BONE_IDS, BONES, type BoneId } from "./skeleton";
import { type Crop, isCrop } from "./crop";

const CORE_IDS = BONES.filter((b) => b.core).map((b) => b.id);

export interface SmoothConfig {
  /** One-Euro minimum cutoff (Hz). Lower = smoother when still. */
  minCutoff: number;
  /** One-Euro speed coefficient. Higher = less lag when moving. */
  beta: number;
}

export const DEFAULT_SMOOTH: SmoothConfig = { minCutoff: 1.5, beta: 1.0 };

export interface SourceInfo {
  name: string;
  duration: number;
  fps: number;
  /** Pixel size of the tracked frame — the crop, when there is one. */
  width: number;
  height: number;
  /** Region of the original video that was tracked, as fractions. Absent = whole frame. */
  crop?: Crop;
}

export type LiftMode = "anchored" | "world";

export interface Score {
  version: 1;
  source: SourceInfo;
  grid: GridConfig;
  smooth: SmoothConfig;
  lift: LiftMode;
  body: Body;
  raw: Pose[];
  frames: Pose[];
  keyframes: number[];
}

/* ---------- body ---------- */

export function measureBody(ex: Extraction[], mode: LiftMode = "anchored"): Body {
  if (mode === "anchored" && ex.some((e) => e.evidence)) return bodyFromEdges(ex);
  const good = ex.filter((e) => e.pose.conf > 0.5);
  const use = good.length >= 5 ? good : ex;
  const lengths = {} as Record<BoneId, number>;
  for (const id of BONE_IDS) lengths[id] = median(use.map((e) => e.lengths[id]));
  return {
    lengths,
    hipWidth: median(use.map((e) => e.hipWidth)),
    shoulderWidth: median(use.map((e) => e.shoulderWidth)),
  };
}

/* ---------- smoothing ---------- */

/**
 * The One-Euro filters behind `smoothPoses`, one frame at a time — causal,
 * so the live pipeline (live.ts) uses the very same smoothing. `centre` is
 * subtracted from the stage position: the clip's median offline, where the
 * dancer started when live.
 */
export class PoseSmoother {
  private boneF: Record<BoneId, OneEuro3>;
  private facingF: OneEuro3;
  private hipF: OneEuro;
  private xF: OneEuro;
  private zF: OneEuro;
  private tPrev: number | null = null;
  constructor(cfg: SmoothConfig, private centre: { x: number; z: number }) {
    this.boneF = Object.fromEntries(BONE_IDS.map((id) => [id, new OneEuro3(cfg.minCutoff, cfg.beta)])) as Record<BoneId, OneEuro3>;
    this.facingF = new OneEuro3(cfg.minCutoff, cfg.beta);
    this.hipF = new OneEuro(cfg.minCutoff, cfg.beta);
    this.xF = new OneEuro(cfg.minCutoff * 0.6, cfg.beta);
    this.zF = new OneEuro(cfg.minCutoff * 0.4, cfg.beta);
  }
  push(p: Pose): Pose {
    const dt = this.tPrev === null ? 1e-3 : Math.max(1e-3, p.t - this.tPrev);
    this.tPrev = p.t;
    const bones = {} as Record<BoneId, AzEl>;
    for (const id of BONE_IDS) bones[id] = toAzEl(this.boneF[id].filter(fromAzEl(p.bones[id]), dt));
    const facing = toAzEl(this.facingF.filter(fromAzEl([p.facing, 0]), dt))[0];
    return {
      ...p,
      bones,
      facing,
      hipY: this.hipF.filter(p.hipY, dt),
      x: this.xF.filter(p.x - this.centre.x, dt),
      z: this.zF.filter(p.z - this.centre.z, dt),
    };
  }
}

export function smoothPoses(poses: Pose[], cfg: SmoothConfig): Pose[] {
  if (!poses.length) return [];
  // Put the dancer's typical position at the centre of the stage.
  const smoother = new PoseSmoother(cfg, { x: median(poses.map((p) => p.x)), z: median(poses.map((p) => p.z)) });
  return poses.map((p) => smoother.push(p));
}

/* ---------- snapping ---------- */

interface Track {
  cell: Cell | null;
  pending: Cell | null;
  pendingSince: number;
  /** First frame of the current departure from `cell` (−1 while at rest). */
  leftSince: number;
}

/** Snap a smoothed sequence to the grid with hysteresis and minimum dwell. */
export function snapPoses(raw: Pose[], g: GridConfig): { frames: Pose[]; keyframes: number[] } {
  const frames: Pose[] = raw.map((p) => ({ ...p, bones: { ...p.bones } }));
  const tracks = Object.fromEntries(BONE_IDS.map((id) => [id, { cell: null, pending: null, pendingSince: 0, leftSince: -1 } as Track])) as Record<BoneId, Track>;
  const cells: Record<BoneId, Cell>[] = [];

  for (let i = 0; i < raw.length; i++) {
    const cur = {} as Record<BoneId, Cell>;
    for (const id of BONE_IDS) {
      const tr = tracks[id];
      const cand = snapCell(g, tr.cell, raw[i].bones[id]);
      if (tr.cell === null) {
        tr.cell = cand;
      } else if (!sameCell(cand, tr.cell) && g.minDwell <= 1) {
        tr.cell = cand;
        tr.pending = null;
        tr.leftSince = -1;
      } else if (!sameCell(cand, tr.cell)) {
        if (tr.leftSince < 0) tr.leftSince = i;
        if (tr.pending && sameCell(cand, tr.pending)) {
          if (i - tr.pendingSince + 1 >= g.minDwell) {
            // Accept. The movement began when the segment left the old cell and
            // settled when the new one held; place the change midway so a fast
            // sweep through intermediate cells reads on time, not late.
            const from = Math.floor((tr.leftSince + tr.pendingSince) / 2);
            for (let k = from; k < i; k++) cells[k][id] = cand;
            tr.cell = cand;
            tr.pending = null;
            tr.leftSince = -1;
          }
        } else {
          tr.pending = cand;
          tr.pendingSince = i;
        }
      } else {
        tr.pending = null;
        tr.leftSince = -1;
      }
      cur[id] = tr.cell!;
    }
    cells.push(cur);
  }

  // Facing: plain snap with a little hysteresis via the same helper on a 1-D grid.
  let facingCell = snapAngle(g.facingStep, raw[0]?.facing ?? 0);
  const keyframes: number[] = [];
  let prevSig = "";
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i].facing;
    const d = Math.abs((((f - facingCell) % 360) + 540) % 360 - 180);
    if (d > g.facingStep * (0.5 + g.hysteresis)) facingCell = snapAngle(g.facingStep, f);
    frames[i].facing = facingCell;
    for (const id of BONE_IDS) frames[i].bones[id] = cellToAzEl(g, cells[i][id]);
    // Keyframes are where the *notation* changes: core segments and facing only.
    const sig = CORE_IDS.map((id) => cells[i][id].join(",")).join("|") + "|" + facingCell;
    if (sig !== prevSig) keyframes.push(i);
    prevSig = sig;
  }
  return { frames, keyframes };
}

/* ---------- assembling ---------- */

/** Raw (unsmoothed) poses for a clip under the chosen lifting mode. */
export function rawPoses(ex: Extraction[], mode: LiftMode): Pose[] {
  return mode === "anchored" ? liftClip(ex) : ex.map((e) => e.pose);
}

export function buildScore(
  ex: Extraction[],
  source: SourceInfo,
  grid: GridConfig = DEFAULT_GRID,
  smooth: SmoothConfig = DEFAULT_SMOOTH,
  lift: LiftMode = "anchored",
): Score {
  const body = measureBody(ex, lift);
  const raw = smoothPoses(rawPoses(ex, lift), smooth);
  const { frames, keyframes } = snapPoses(raw, grid);
  return { version: 1, source, grid, smooth, lift, body, raw, frames, keyframes };
}

/** Frame index at time t (seconds). */
export function frameAt(score: Score, t: number): number {
  const n = score.frames.length;
  if (!n) return 0;
  const i = Math.round(t * score.source.fps);
  return Math.max(0, Math.min(n - 1, i));
}

/* ---------- serialisation ---------- */

const r2 = (n: number) => Math.round(n * 100) / 100;
const roundPose = (p: Pose): Pose => ({
  t: Math.round(p.t * 1000) / 1000,
  facing: r2(p.facing),
  x: r2(p.x),
  z: r2(p.z),
  hipY: r2(p.hipY),
  conf: r2(p.conf),
  bones: Object.fromEntries(Object.entries(p.bones).map(([k, [a, e]]) => [k, [r2(a), r2(e)]])) as Record<BoneId, AzEl>,
});

export function serializeScore(s: Score): string {
  return JSON.stringify({ ...s, raw: s.raw.map(roundPose), frames: s.frames.map(roundPose) });
}

export function parseScore(text: string): Score {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This file is not valid JSON. Choose an exported vid2grid dance."); }
  const fail = (): never => { throw new Error("This dance is incomplete or invalid. Choose a complete vid2grid JSON export."); };
  if (!value || typeof value !== "object") return fail();
  const s = value as Score;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const positive = (n: unknown) => finite(n) && n > 0;
  if (s.version !== 1 || !s.source || typeof s.source.name !== "string" ||
      !positive(s.source.duration) || s.source.duration > 3600 ||
      !positive(s.source.fps) || s.source.fps > 240 ||
      !positive(s.source.width) || !positive(s.source.height) ||
      (s.source.crop !== undefined && !isCrop(s.source.crop))) return fail();
  if (!s.grid || !s.smooth || !s.body?.lengths) return fail();
  const divides = (step: number, angle: number) => positive(step) && step >= 1 && Math.abs(angle / step - Math.round(angle / step)) < 1e-6;
  if (!divides(s.grid.azStep, 360) || !divides(s.grid.elStep, 90) || !divides(s.grid.facingStep, 360) ||
      !finite(s.grid.hysteresis) || s.grid.hysteresis < 0 || s.grid.hysteresis > 0.5 ||
      !Number.isInteger(s.grid.minDwell) || s.grid.minDwell < 1 || s.grid.minDwell > 120 ||
      !positive(s.smooth.minCutoff) || !finite(s.smooth.beta) || s.smooth.beta < 0 ||
      !positive(s.body.hipWidth) || !positive(s.body.shoulderWidth) ||
      BONE_IDS.some((id) => !positive(s.body.lengths[id]))) return fail();
  // Earlier v1 exports predate the explicit lifting-mode field.
  s.lift ??= "anchored";
  if (s.lift !== "anchored" && s.lift !== "world") return fail();
  if (!Array.isArray(s.raw) || !Array.isArray(s.frames) || !s.frames.length || s.frames.length > 108000 || s.raw.length !== s.frames.length) return fail();
  const validPose = (p: Pose, i: number, poses: Pose[]) => p &&
    [p.t, p.x, p.z, p.hipY, p.facing, p.conf].every(finite) && p.t >= 0 &&
    p.t <= s.source.duration + .001 && (i === 0 || p.t > poses[i - 1].t) &&
    Math.abs(p.t - i / s.source.fps) <= .002 && p.conf >= 0 && p.conf <= 1 && p.bones &&
    BONE_IDS.every((id) => Array.isArray(p.bones[id]) && p.bones[id].length === 2 && p.bones[id].every(finite) && Math.abs(p.bones[id][1]) <= 90);
  if (!s.raw.every(validPose) || !s.frames.every(validPose) || !Array.isArray(s.keyframes) ||
      s.keyframes.some((k, i) => !Number.isInteger(k) || k < 0 || k >= s.frames.length || (i > 0 && k <= s.keyframes[i - 1]))) return fail();
  return s;
}
