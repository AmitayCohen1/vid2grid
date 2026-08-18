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
  width: number;
  height: number;
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

export function smoothPoses(poses: Pose[], cfg: SmoothConfig): Pose[] {
  if (!poses.length) return [];
  // Put the dancer's typical position at the centre of the stage.
  const cx = median(poses.map((p) => p.x));
  const cz = median(poses.map((p) => p.z));
  const boneF = Object.fromEntries(BONE_IDS.map((id) => [id, new OneEuro3(cfg.minCutoff, cfg.beta)])) as Record<BoneId, OneEuro3>;
  const facingF = new OneEuro3(cfg.minCutoff, cfg.beta);
  const hipF = new OneEuro(cfg.minCutoff, cfg.beta);
  const xF = new OneEuro(cfg.minCutoff * 0.6, cfg.beta);
  const zF = new OneEuro(cfg.minCutoff * 0.4, cfg.beta);
  const out: Pose[] = [];
  let tPrev = poses[0].t;
  for (const p of poses) {
    const dt = Math.max(1e-3, p.t - tPrev);
    tPrev = p.t;
    const bones = {} as Record<BoneId, AzEl>;
    for (const id of BONE_IDS) bones[id] = toAzEl(boneF[id].filter(fromAzEl(p.bones[id]), dt));
    const facing = toAzEl(facingF.filter(fromAzEl([p.facing, 0]), dt))[0];
    out.push({
      ...p,
      bones,
      facing,
      hipY: hipF.filter(p.hipY, dt),
      x: xF.filter(p.x - cx, dt),
      z: zF.filter(p.z - cz, dt),
    });
  }
  return out;
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
  const s = JSON.parse(text) as Score;
  if (s.version !== 1 || !Array.isArray(s.frames) || !s.source) throw new Error("Not a vid2grid score");
  return s;
}
