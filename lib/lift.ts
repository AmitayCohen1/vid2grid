/* ------------------------------------------------------------------
   2D-anchored lifting.

   MediaPipe's image landmarks are precise; its metric "world" depth is
   not. So: take x/y from the image (scaled to metres at the dancer's
   depth), take only the *sign* of depth from the world estimate, and
   solve each segment's depth from the dancer's own bone lengths —
   measured as medians across the whole clip. Bone lengths become a
   hard constraint instead of a hope.
   ------------------------------------------------------------------ */

import { median } from "./filter";
import { type AzEl, type Vec3, cross, len, mid, norm, sub, toAzEl, toFrame, v3, wrap360 } from "./geometry";
import type { Extraction, Landmark, Pose } from "./pose";
import { BONE_IDS, type BoneId, LM } from "./skeleton";

/** Per-landmark evidence kept from tracking, hip-centred, stage axes (x right, y up, z towards audience). */
export interface LandmarkEvidence {
  /** [img_x_m, img_y_m, world_z_m, vis, world_x_m, world_y_m] × 33 */
  data: Float32Array;
}

const N = 33;
const S = 6;

/** Build the evidence buffer for one frame. Stage frame: x right, y up, z towards audience. */
export function landmarkEvidence(world: Landmark[], image: Landmark[], aspect: number, metresPerUnit: number): LandmarkEvidence {
  const cx = (image[LM.leftHip].x + image[LM.rightHip].x) / 2;
  const cy = (image[LM.leftHip].y + image[LM.rightHip].y) / 2;
  const data = new Float32Array(N * S);
  for (let i = 0; i < N; i++) {
    data[i * S] = (image[i].x - cx) * metresPerUnit;
    data[i * S + 1] = -((image[i].y - cy) / aspect) * metresPerUnit;
    data[i * S + 2] = -world[i].z; // stage z (towards audience) — sign/ordering evidence only
    data[i * S + 3] = image[i].visibility ?? 0;
    data[i * S + 4] = world[i].x;
    data[i * S + 5] = -world[i].y;
  }
  return { data };
}

/* Kinematic tree over landmarks. Virtual roots: -1 = hip midpoint, -2 = shoulder midpoint. */
const HIP_MID = -1, SH_MID = -2;
const TREE: [parent: number, child: number][] = [
  [HIP_MID, LM.leftHip], [HIP_MID, LM.rightHip],
  [HIP_MID, LM.leftShoulder], [HIP_MID, LM.rightShoulder],
  [SH_MID, LM.leftEar], [SH_MID, LM.rightEar], [SH_MID, LM.nose],
  [LM.leftShoulder, LM.leftElbow], [LM.leftElbow, LM.leftWrist], [LM.leftWrist, LM.leftIndex],
  [LM.rightShoulder, LM.rightElbow], [LM.rightElbow, LM.rightWrist], [LM.rightWrist, LM.rightIndex],
  [LM.leftHip, LM.leftKnee], [LM.leftKnee, LM.leftAnkle], [LM.leftAnkle, LM.leftFootIndex], [LM.leftAnkle, LM.leftHeel],
  [LM.rightHip, LM.rightKnee], [LM.rightKnee, LM.rightAnkle], [LM.rightAnkle, LM.rightFootIndex], [LM.rightAnkle, LM.rightHeel],
];

/** Image-plane point (metres) of a landmark or virtual joint. */
function imgPoint(ev: Float32Array, i: number): Vec3 {
  if (i >= 0) return v3(ev[i * S], ev[i * S + 1], 0);
  if (i === HIP_MID) return v3(0, 0, 0);
  return mid(imgPoint(ev, LM.leftShoulder), imgPoint(ev, LM.rightShoulder));
}
/** World-estimate point of a landmark or virtual joint. */
function worldPoint(ev: Float32Array, i: number): Vec3 {
  if (i >= 0) return v3(ev[i * S + 4], ev[i * S + 5], ev[i * S + 2]);
  if (i === HIP_MID) return v3(0, 0, 0);
  return mid(worldPoint(ev, LM.leftShoulder), worldPoint(ev, LM.rightShoulder));
}

/**
 * Length of every tree edge over the clip. Two estimators, take the larger:
 * the 90th percentile of the image-plane length (a segment shows its full
 * length only when it lies in the image plane), and the median of the world
 * estimate's 3D length (roughly metric, but noisy).
 */
export function measureEdges(frames: LandmarkEvidence[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [p, c] of TREE) {
    const planar: number[] = [];
    const world: number[] = [];
    for (const f of frames) {
      const a = imgPoint(f.data, p), b = imgPoint(f.data, c);
      planar.push(Math.hypot(b.x - a.x, b.y - a.y));
      const wa = worldPoint(f.data, p), wb = worldPoint(f.data, c);
      world.push(len(sub(wb, wa)));
    }
    planar.sort((x, y) => x - y);
    const p90 = planar[Math.min(planar.length - 1, Math.floor(planar.length * 0.9))] || 0;
    out.set(`${p}:${c}`, Math.max(p90, median(world), 0.03));
  }
  return out;
}

/**
 * Lift one frame: walk the tree keeping image xy exact. Depth comes from the
 * world estimate but is clamped to what the segment's length permits:
 * |dz| ≤ √(L² − planar²). That kills the classic overshoot (a raised arm
 * read as "forward") without inventing depth where the evidence is thin.
 * When the world estimate is ambiguous, the sign follows the previous frame.
 */
export function liftFrame(
  ev: LandmarkEvidence,
  edges: Map<string, number>,
  prevSigns: Map<string, number>,
): Map<number, Vec3> {
  const pts = new Map<number, Vec3>();
  pts.set(HIP_MID, v3(0, 0, 0));
  for (const [p, c] of TREE) {
    if (p === SH_MID && !pts.has(SH_MID)) pts.set(SH_MID, mid(pts.get(LM.leftShoulder)!, pts.get(LM.rightShoulder)!));
    const a = pts.get(p)!;
    const L = edges.get(`${p}:${c}`) ?? 0.1;
    const { x: bx, y: by } = imgPoint(ev.data, c);
    const { x: ax, y: ay } = imgPoint(ev.data, p);
    const dx = bx - ax, dy = by - ay;
    const maxDz = Math.sqrt(Math.max(0, L * L - (dx * dx + dy * dy)));
    const wdz = worldPoint(ev.data, c).z - worldPoint(ev.data, p).z;
    const key = `${p}:${c}`;
    let sign = Math.abs(wdz) > 0.03 ? Math.sign(wdz) : (prevSigns.get(key) ?? Math.sign(wdz) ?? 1);
    if (sign === 0) sign = 1;
    prevSigns.set(key, sign);
    const dz = sign * Math.min(Math.abs(wdz), maxDz);
    pts.set(c, v3(a.x + dx, a.y + dy, a.z + dz));
  }
  return pts;
}

/** Turn lifted points into a Pose (directions in the dancer's frame). */
export function poseFromPoints(pts: Map<number, Vec3>, base: Pose): Pose {
  const P = (i: number) => pts.get(i)!;
  const lhip = P(LM.leftHip), rhip = P(LM.rightHip);
  const lsh = P(LM.leftShoulder), rsh = P(LM.rightShoulder);
  const hipMid = v3(0, 0, 0);
  const shoulderMid = mid(lsh, rsh);
  const headTop = mid(P(LM.leftEar), P(LM.rightEar));

  const up = v3(0, 1, 0);
  const hipVec = sub(rhip, lhip);
  const flat = v3(hipVec.x, 0, hipVec.z);
  const right = len(flat) > 1e-3 ? norm(flat) : v3(-1, 0, 0);
  const fwd = norm(cross(up, right));
  const facing = wrap360(toAzEl(fwd)[0]);

  const bones = {} as Record<BoneId, AzEl>;
  const seg = (id: BoneId, a: Vec3, b: Vec3) => { bones[id] = toAzEl(toFrame(sub(b, a), right, up, fwd)); };
  seg("torso", hipMid, shoulderMid);
  seg("shoulders", lsh, rsh);
  seg("head", shoulderMid, headTop);
  seg("ruarm", rsh, P(LM.rightElbow));
  seg("rfarm", P(LM.rightElbow), P(LM.rightWrist));
  seg("rhand", P(LM.rightWrist), P(LM.rightIndex));
  seg("luarm", lsh, P(LM.leftElbow));
  seg("lfarm", P(LM.leftElbow), P(LM.leftWrist));
  seg("lhand", P(LM.leftWrist), P(LM.leftIndex));
  seg("rthigh", rhip, P(LM.rightKnee));
  seg("rshin", P(LM.rightKnee), P(LM.rightAnkle));
  seg("rfoot", P(LM.rightAnkle), P(LM.rightFootIndex));
  seg("lthigh", lhip, P(LM.leftKnee));
  seg("lshin", P(LM.leftKnee), P(LM.leftAnkle));
  seg("lfoot", P(LM.leftAnkle), P(LM.leftFootIndex));
  for (const id of BONE_IDS) if (!bones[id]) bones[id] = [0, 0];

  const feet = [LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex, LM.leftAnkle, LM.rightAnkle].map((i) => P(i).y);
  const hipY = Math.max(0.3, -Math.min(...feet));

  return { ...base, facing, hipY, bones };
}

/** Lift a whole clip. Falls back to the world-only pose where evidence is missing. */
export function liftClip(ex: Extraction[]): Pose[] {
  const evs = ex.map((e) => e.evidence).filter((e): e is LandmarkEvidence => !!e);
  if (evs.length < 3) return ex.map((e) => e.pose);
  const edges = measureEdges(evs);
  const signs = new Map<string, number>();
  return ex.map((e) => (e.evidence ? poseFromPoints(liftFrame(e.evidence, edges, signs), e.pose) : e.pose));
}

/** Body measurements from the lifted edge lengths (metres). */
export function bodyFromEdges(ex: Extraction[]) {
  const evs = ex.map((e) => e.evidence).filter((e): e is LandmarkEvidence => !!e);
  const edges = measureEdges(evs);
  const E = (p: number, c: number) => edges.get(`${p}:${c}`) ?? 0.1;
  const width = (l: number, r: number) => {
    const xs = evs.map((f) => Math.hypot(f.data[r * S] - f.data[l * S], f.data[r * S + 1] - f.data[l * S + 1])).sort((a, b) => a - b);
    const p90 = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))] || 0;
    return Math.max(p90, median(evs.map((f) => len(sub(worldPoint(f.data, r), worldPoint(f.data, l))))));
  };
  const hipWidth = width(LM.leftHip, LM.rightHip);
  const shoulderWidth = width(LM.leftShoulder, LM.rightShoulder);
  const torso = (E(HIP_MID, LM.leftShoulder) + E(HIP_MID, LM.rightShoulder)) / 2;
  // torso as hipMid→shoulderMid: shoulders sit half a shoulder-width out, so
  const torsoLen = Math.sqrt(Math.max(0.05, torso * torso - (shoulderWidth / 2) ** 2));
  const head = (E(SH_MID, LM.leftEar) + E(SH_MID, LM.rightEar)) / 2;
  const lengths: Record<BoneId, number> = {
    torso: torsoLen, shoulders: shoulderWidth, head,
    ruarm: E(LM.rightShoulder, LM.rightElbow), rfarm: E(LM.rightElbow, LM.rightWrist), rhand: E(LM.rightWrist, LM.rightIndex),
    luarm: E(LM.leftShoulder, LM.leftElbow), lfarm: E(LM.leftElbow, LM.leftWrist), lhand: E(LM.leftWrist, LM.leftIndex),
    rthigh: E(LM.rightHip, LM.rightKnee), rshin: E(LM.rightKnee, LM.rightAnkle), rfoot: E(LM.rightAnkle, LM.rightFootIndex),
    lthigh: E(LM.leftHip, LM.leftKnee), lshin: E(LM.leftKnee, LM.leftAnkle), lfoot: E(LM.leftAnkle, LM.leftFootIndex),
  };
  return { lengths, hipWidth, shoulderWidth };
}
