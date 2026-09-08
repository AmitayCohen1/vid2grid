/* ------------------------------------------------------------------
   Live: the score pipeline one frame at a time.

   The offline pipeline (score.ts) sees the whole clip: the body is measured
   over every frame, positions are centred on the clip's median, and a grid
   change is back-dated to when the limb left its old cell. Live, nothing
   after "now" exists, so each stage here is the causal twin:

     body   — re-measured on a growing sample as frames arrive
     lift   — per frame from the current body (lift.ts is already causal)
     smooth — the same One-Euro filters, centred where the dancer started
     snap   — hysteresis and dwell, no back-dating: a new direction shows
              once it has held for `minDwell` frames

   What the stage shows live is therefore an approximation. When the take
   ends, its frames are resampled onto the fixed frame rate and go through
   the offline pipeline, and *that* is the score. No DOM, no React here.
   ------------------------------------------------------------------ */

import { type Cell, type GridConfig, cellToAzEl, sameCell, snapAngle, snapCell } from "./grid";
import { type AzEl, angleDiff } from "./geometry";
import type { Body } from "./fk";
import type { Extraction, Pose } from "./pose";
import { type LandmarkEvidence, bodyFromEdges, liftFrame, measureEdges, poseFromPoints } from "./lift";
import { type LiftMode, PoseSmoother, type SmoothConfig, measureBody } from "./score";
import { BONE_IDS, BONES, type BoneId } from "./skeleton";
import type { TrackedFrame } from "./tracker";

const CORE_IDS = BONES.filter((b) => b.core).map((b) => b.id);

/** Snap frame by frame: hysteresis and minimum dwell, but nothing is ever re-written. */
export class CausalSnapper {
  private tracks: Record<BoneId, { cell: Cell | null; pending: Cell | null; pendingSince: number }>;
  private i = 0;
  private facingCell: number | null = null;
  private prevSig = "";
  constructor(private g: GridConfig) {
    this.tracks = Object.fromEntries(BONE_IDS.map((id) => [id, { cell: null, pending: null, pendingSince: 0 }])) as CausalSnapper["tracks"];
  }
  /** The snapped pose, and whether the notation (core segments or facing) just changed. */
  push(raw: Pose): { pose: Pose; keyframe: boolean } {
    const g = this.g;
    const bones = {} as Record<BoneId, AzEl>;
    for (const id of BONE_IDS) {
      const tr = this.tracks[id];
      const cand = snapCell(g, tr.cell, raw.bones[id]);
      if (tr.cell === null || g.minDwell <= 1 || sameCell(cand, tr.cell)) {
        tr.cell = cand;
        tr.pending = null;
      } else if (tr.pending && sameCell(cand, tr.pending)) {
        if (this.i - tr.pendingSince + 1 >= g.minDwell) { tr.cell = cand; tr.pending = null; }
      } else {
        tr.pending = cand;
        tr.pendingSince = this.i;
      }
      bones[id] = cellToAzEl(g, tr.cell!);
    }
    if (this.facingCell === null || Math.abs(angleDiff(this.facingCell, raw.facing)) > g.facingStep * (0.5 + g.hysteresis)) {
      this.facingCell = snapAngle(g.facingStep, raw.facing);
    }
    const sig = CORE_IDS.map((id) => bones[id].join(",")).join("|") + "|" + this.facingCell;
    const keyframe = sig !== this.prevSig;
    this.prevSig = sig;
    this.i++;
    return { pose: { ...raw, bones, facing: this.facingCell }, keyframe };
  }
}

export interface LiveOptions {
  grid: GridConfig;
  smooth: SmoothConfig;
  lift: LiftMode;
}

/** One frame as the stage should draw it right now. */
export interface LiveFrame {
  t: number;
  raw: Pose;
  snapped: Pose;
  body: Body;
  /** Notation changes so far. */
  keyframes: number;
}

/** Frames (with evidence) at which the body is re-measured, then every REMEASURE_EVERY. */
const REMEASURE = [3, 8, 15, 30, 60, 120, 240];
const REMEASURE_EVERY = 240;
/** Most frames a measurement looks at; beyond this the take is sampled evenly. */
const MEASURE_SAMPLE = 600;

export class LiveScore {
  private exs: Extraction[] = [];
  private edges: Map<string, number> | null = null;
  private body: Body | null = null;
  private signs = new Map<string, number>();
  private smoother: PoseSmoother | null = null;
  private centre: { x: number; z: number } | null = null;
  private snapper: CausalSnapper;
  private last: Extraction | null = null;
  private opts: LiveOptions;
  keyframes = 0;

  constructor(opts: LiveOptions) {
    this.opts = { ...opts };
    this.snapper = new CausalSnapper(opts.grid);
  }

  /** Settings change live like they do offline; the affected stage simply restarts from here. */
  setGrid(grid: GridConfig) { this.opts.grid = grid; this.snapper = new CausalSnapper(grid); }
  setSmooth(smooth: SmoothConfig) { this.opts.smooth = smooth; this.smoother = null; }
  setLift(lift: LiftMode) { if (lift !== this.opts.lift) { this.opts.lift = lift; this.body = null; this.remeasure(); } }

  private remeasure() {
    const n = this.exs.length;
    if (n < 3) return;
    const step = Math.max(1, Math.floor(n / MEASURE_SAMPLE));
    const sample = step > 1 ? this.exs.filter((_, i) => i % step === 0) : this.exs;
    if (this.opts.lift === "anchored") {
      const evs = sample.map((e) => e.evidence).filter((e): e is LandmarkEvidence => !!e);
      if (evs.length >= 3) {
        this.edges = measureEdges(evs);
        this.body = bodyFromEdges(sample, this.edges);
        return;
      }
    }
    this.body = measureBody(sample, "world");
  }

  /**
   * One tracked frame at `t` seconds (null when the dancer was not seen: the
   * last pose is held). Null until enough has been seen to know the body.
   */
  push(e: Extraction | null, t: number): LiveFrame | null {
    if (e) {
      this.last = e;
      this.exs.push(e);
      const n = this.exs.length;
      if (REMEASURE.includes(n) || n % REMEASURE_EVERY === 0) this.remeasure();
    }
    const ex = this.last;
    if (!ex || !this.body) return null;
    let pose: Pose = { ...ex.pose, t, conf: e ? ex.pose.conf : 0 };
    if (this.opts.lift === "anchored" && ex.evidence && this.edges) {
      pose = poseFromPoints(liftFrame(ex.evidence, this.edges, this.signs), pose);
    }
    if (!this.smoother) {
      this.centre ??= { x: pose.x, z: pose.z };
      this.smoother = new PoseSmoother(this.opts.smooth, this.centre);
    }
    const raw = this.smoother.push(pose);
    const { pose: snapped, keyframe } = this.snapper.push(raw);
    if (keyframe) this.keyframes++;
    return { t, raw, snapped, body: this.body, keyframes: this.keyframes };
  }
}

/** What the camera loop keeps per detection, at whatever rate it ran. */
export interface LiveSample {
  t: number;
  extraction: Extraction | null;
  image: Float32Array | null;
}

/**
 * Lay irregular live samples onto the score's fixed frame rate: each slot
 * takes the latest sighting at or before its time, held for at most
 * `maxGap` seconds — longer gaps stay empty for `fillGaps` to bridge.
 */
export function resampleLive(samples: LiveSample[], fps: number, duration: number, maxGap = 0.5): TrackedFrame[] {
  const total = Math.max(1, Math.floor(duration * fps));
  const out: TrackedFrame[] = [];
  let j = 0;
  let seen: LiveSample | null = null;
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    while (j < samples.length && samples[j].t <= t + 0.5 / fps) {
      if (samples[j].extraction) seen = samples[j];
      j++;
    }
    if (seen?.extraction && t - seen.t <= maxGap) {
      out.push({ extraction: { ...seen.extraction, pose: { ...seen.extraction.pose, t } }, image: seen.image });
    } else {
      out.push({ extraction: null, image: null });
    }
  }
  return out;
}
