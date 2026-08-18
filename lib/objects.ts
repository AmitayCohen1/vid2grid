/* ------------------------------------------------------------------
   Synchronous-Objects-style derivations (after Forsythe / OSU, 2009):
   traces of body parts, alignments between limbs, movement density.
   All computed on 2D points so they can be drawn straight onto video.
   ------------------------------------------------------------------ */

import type { JointId } from "./skeleton";
import { LM } from "./skeleton";
import { forwardKinematics, type Body } from "./fk";
import type { Pose } from "./pose";

export type Pt = [x: number, y: number];
/** 2D positions in normalised image units (x 0..1 across, y 0..1 down). */
export type Points2D = Partial<Record<JointId, Pt>>;

/** Landmark index behind each named joint (for tracked clips). */
const JOINT_LM: Partial<Record<JointId, number>> = {
  lshoulder: LM.leftShoulder, rshoulder: LM.rightShoulder,
  lelbow: LM.leftElbow, relbow: LM.rightElbow,
  lwrist: LM.leftWrist, rwrist: LM.rightWrist,
  lhandTip: LM.leftIndex, rhandTip: LM.rightIndex,
  lhip: LM.leftHip, rhip: LM.rightHip,
  lknee: LM.leftKnee, rknee: LM.rightKnee,
  lankle: LM.leftAnkle, rankle: LM.rightAnkle,
  ltoe: LM.leftFootIndex, rtoe: LM.rightFootIndex,
};

export function pointsFromLandmarks(buf: Float32Array): Points2D {
  const out: Points2D = {};
  for (const [j, i] of Object.entries(JOINT_LM) as [JointId, number][]) {
    if (buf[i * 3 + 2] > 0.3) out[j] = [buf[i * 3], buf[i * 3 + 1]];
  }
  const nose = [buf[LM.nose * 3], buf[LM.nose * 3 + 1]] as Pt;
  out.headTop = [(buf[LM.leftEar * 3] + buf[LM.rightEar * 3]) / 2, (buf[LM.leftEar * 3 + 1] + buf[LM.rightEar * 3 + 1]) / 2];
  if (buf[LM.nose * 3 + 2] > 0.3) out.headTop = nose;
  const l = out.lshoulder, r = out.rshoulder;
  if (l && r) out.shoulderMid = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
  const lh = out.lhip, rh = out.rhip;
  if (lh && rh) out.hipMid = [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2];
  return out;
}

/** Fallback when there is no video: an orthographic front view of the 3D figure. */
export function pointsFromPose(pose: Pose, body: Body, aspect: number): Points2D {
  const J = forwardKinematics(pose, body);
  const out: Points2D = {};
  const scale = 0.42; // metres → image height fraction
  for (const [k, v] of Object.entries(J) as [JointId, { x: number; y: number }][]) {
    out[k] = [0.5 - (v.x - pose.x) * scale / aspect, 0.92 - v.y * scale];
  }
  return out;
}

/* ---------- traces ---------- */

export const TRACE_JOINTS: { id: JointId; color: string }[] = [
  { id: "lwrist", color: "#4cc9f0" },
  { id: "rwrist", color: "#f72585" },
  { id: "lankle", color: "#4cc9f0" },
  { id: "rankle", color: "#f72585" },
  { id: "headTop", color: "#e8e9ec" },
];

/* ---------- alignments ---------- */

const SEGS: [JointId, JointId, string][] = [
  ["lshoulder", "lelbow", "L upper arm"], ["lelbow", "lwrist", "L forearm"],
  ["rshoulder", "relbow", "R upper arm"], ["relbow", "rwrist", "R forearm"],
  ["lhip", "lknee", "L thigh"], ["lknee", "lankle", "L shin"],
  ["rhip", "rknee", "R thigh"], ["rknee", "rankle", "R shin"],
  ["hipMid", "shoulderMid", "torso"],
  ["lshoulder", "rshoulder", "shoulders"], ["lhip", "rhip", "hips"],
];

export interface Alignment {
  a: [Pt, Pt];
  b: [Pt, Pt];
  labels: [string, string];
  /** 0 = parallel, 1 = collinear (on the same line). */
  collinear: boolean;
}

/**
 * Pairs of limbs that line up: parallel within `tolDeg`, and collinear if one
 * segment's midpoint sits on the other's line. Vertical/horizontal
 * coincidences of the frame are not excluded — Forsythe kept those too.
 */
export function alignments(p: Points2D, aspect: number, tolDeg = 5): Alignment[] {
  const out: Alignment[] = [];
  const segs = SEGS.map(([a, b, label]) => (p[a] && p[b] ? { a: p[a]!, b: p[b]!, label } : null)).filter(Boolean) as { a: Pt; b: Pt; label: string }[];
  const dir = (s: { a: Pt; b: Pt }) => {
    const dx = (s.b[0] - s.a[0]) * aspect, dy = s.b[1] - s.a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l, l] as const;
  };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      // Skip trivially connected pairs (share a joint) — always nearly aligned.
      if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue;
      const [ux, uy, ul] = dir(s), [vx, vy, vl] = dir(t);
      if (ul < 0.03 || vl < 0.03) continue;
      const cos = Math.abs(ux * vx + uy * vy);
      const ang = Math.acos(Math.min(1, cos)) * (180 / Math.PI);
      if (ang > tolDeg) continue;
      // distance from t's midpoint to s's line
      const mx = ((t.a[0] + t.b[0]) / 2 - s.a[0]) * aspect, my = (t.a[1] + t.b[1]) / 2 - s.a[1];
      const dist = Math.abs(mx * uy - my * ux);
      out.push({ a: [s.a, s.b], b: [t.a, t.b], labels: [s.label, t.label], collinear: dist < 0.02 });
    }
  }
  return out;
}

/* ---------- movement density ---------- */

/** Mean joint speed per frame, normalised so the 95th percentile ≈ 1. */
export function movementDensity(frames: (Points2D | null)[], aspect: number): Float32Array {
  const n = frames.length;
  const raw = new Float32Array(n);
  const ids: JointId[] = ["lwrist", "rwrist", "lankle", "rankle", "lelbow", "relbow", "lknee", "rknee", "headTop"];
  for (let i = 1; i < n; i++) {
    const a = frames[i - 1], b = frames[i];
    if (!a || !b) continue;
    let s = 0, c = 0;
    for (const id of ids) {
      const pa = a[id], pb = b[id];
      if (!pa || !pb) continue;
      s += Math.hypot((pb[0] - pa[0]) * aspect, pb[1] - pa[1]);
      c++;
    }
    raw[i] = c ? s / c : 0;
  }
  const sorted = Array.from(raw).sort((x, y) => x - y);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1.5, raw[i] / p95);
  // light box smoothing
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) { s += out[j]; c++; } }
    sm[i] = s / c;
  }
  return sm;
}
