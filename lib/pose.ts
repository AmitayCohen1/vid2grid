/* ------------------------------------------------------------------
   Landmarks → a Pose.

   MediaPipe gives 33 landmarks twice: normalised image coordinates
   and "world" coordinates (metres, origin at the hip midpoint, in the
   camera's frame: x = image right, y = image down, z = away from
   camera). From those we build the dancer's own frame and spell every
   segment as (azimuth, elevation) in it. Nothing here is snapped;
   this is the raw evidence the grid is later applied to.
   ------------------------------------------------------------------ */

import { type AzEl, type Vec3, cross, len, mid, norm, sub, toAzEl, toFrame, v3, wrap360 } from "./geometry";
import { BONE_IDS, type BoneId, type JointId, LM } from "./skeleton";
import { type LandmarkEvidence, landmarkEvidence } from "./lift";

export interface Landmark { x: number; y: number; z: number; visibility?: number }

export interface Pose {
  /** Seconds into the source video. */
  t: number;
  /** Which way the dancer faces on stage, degrees (0 = towards the audience/camera). */
  facing: number;
  /** Stage position of the hip midpoint, metres. x = audience's right, z = towards audience. */
  x: number;
  z: number;
  /** Height of the hip midpoint above the lowest foot point, metres. */
  hipY: number;
  /** Every segment as an absolute direction in body-local space. */
  bones: Record<BoneId, AzEl>;
  /** Mean landmark visibility of the core body, 0..1. */
  conf: number;
}

export interface Extraction {
  pose: Pose;
  /** Segment lengths in metres, this frame. */
  lengths: Record<BoneId, number>;
  /** Hip width and shoulder width, metres. */
  hipWidth: number;
  shoulderWidth: number;
  /** Metres per normalised-image-width unit at the dancer's depth. */
  metresPerUnit: number;
  /** Per-landmark evidence for 2D-anchored lifting (see lift.ts). */
  evidence?: LandmarkEvidence;
}

/** Camera frame (MediaPipe) → stage frame (x right, y up, z towards audience). */
const toStage = (p: Landmark): Vec3 => v3(p.x, -p.y, -p.z);

/** Named joints from the 33 landmarks, in stage coordinates. */
export function joints(world: Landmark[]): Record<JointId, Vec3> {
  const P = (i: number) => toStage(world[i]);
  const lhip = P(LM.leftHip), rhip = P(LM.rightHip);
  const lsh = P(LM.leftShoulder), rsh = P(LM.rightShoulder);
  const hipMid = mid(lhip, rhip);
  const shoulderMid = mid(lsh, rsh);
  const earMid = mid(P(LM.leftEar), P(LM.rightEar));
  return {
    hipMid, lhip, rhip, shoulderMid, lshoulder: lsh, rshoulder: rsh,
    headTop: earMid,
    relbow: P(LM.rightElbow), rwrist: P(LM.rightWrist), rhandTip: P(LM.rightIndex),
    lelbow: P(LM.leftElbow), lwrist: P(LM.leftWrist), lhandTip: P(LM.leftIndex),
    rknee: P(LM.rightKnee), rankle: P(LM.rightAnkle), rtoe: P(LM.rightFootIndex),
    lknee: P(LM.leftKnee), lankle: P(LM.leftAnkle), ltoe: P(LM.leftFootIndex),
  };
}

const CORE_LMS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/**
 * Least-squares scale between the world landmarks projected onto the image
 * plane and the normalised image landmarks (both hip-centred), i.e. how many
 * metres one image-width unit spans at the dancer's depth.
 */
function metresPerUnit(world: Landmark[], image: Landmark[], aspect: number): number {
  const wc = { x: (world[23].x + world[24].x) / 2, y: (world[23].y + world[24].y) / 2 };
  const ic = { x: (image[23].x + image[24].x) / 2, y: ((image[23].y + image[24].y) / 2) / aspect };
  let num = 0, den = 0;
  for (const i of CORE_LMS) {
    const wx = world[i].x - wc.x, wy = world[i].y - wc.y;
    const ix = image[i].x - ic.x, iy = image[i].y / aspect - ic.y;
    num += wx * ix + wy * iy;
    den += ix * ix + iy * iy;
  }
  return den > 1e-9 ? num / den : 1;
}

/** Horizontal field of view assumed for placing the dancer in depth (phone-ish). */
const F_UNITS = 0.5 / Math.tan((60 / 2) * (Math.PI / 180));

export function extractPose(
  world: Landmark[],
  image: Landmark[],
  t: number,
  aspect: number,
): Extraction {
  const J = joints(world);

  // Dancer's frame: right from the hip line, up is stage up, forward completes it.
  const up = v3(0, 1, 0);
  const hipVec = sub(J.rhip, J.lhip);
  const rightFlat = norm(v3(hipVec.x, 0, hipVec.z));
  const right = len(v3(hipVec.x, 0, hipVec.z)) > 1e-3 ? rightFlat : v3(1, 0, 0);
  // Stage frame is right-handed (three.js, z towards audience): forward = up × right.
  const fwd = norm(cross(up, right));

  const facing = wrap360(toAzEl(fwd)[0]);

  const bones = {} as Record<BoneId, AzEl>;
  const lengths = {} as Record<BoneId, number>;
  const seg = (id: BoneId, a: Vec3, b: Vec3) => {
    const d = sub(b, a);
    lengths[id] = len(d);
    bones[id] = toAzEl(toFrame(d, right, up, fwd));
  };
  seg("torso", J.hipMid, J.shoulderMid);
  seg("shoulders", J.lshoulder, J.rshoulder);
  seg("head", J.shoulderMid, J.headTop);
  seg("ruarm", J.rshoulder, J.relbow);
  seg("rfarm", J.relbow, J.rwrist);
  seg("rhand", J.rwrist, J.rhandTip);
  seg("luarm", J.lshoulder, J.lelbow);
  seg("lfarm", J.lelbow, J.lwrist);
  seg("lhand", J.lwrist, J.lhandTip);
  seg("rthigh", J.rhip, J.rknee);
  seg("rshin", J.rknee, J.rankle);
  seg("rfoot", J.rankle, J.rtoe);
  seg("lthigh", J.lhip, J.lknee);
  seg("lshin", J.lknee, J.lankle);
  seg("lfoot", J.lankle, J.ltoe);
  for (const id of BONE_IDS) if (!bones[id]) bones[id] = [0, 0];

  // Hip height: hips sit at the origin; the floor is the lowest foot point.
  const feet = [LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex, LM.leftAnkle, LM.rightAnkle]
    .map((i) => toStage(world[i]).y);
  const hipY = Math.max(0.3, -Math.min(...feet));

  // Stage position from the image: x across the frame, z from apparent scale.
  const mpu = metresPerUnit(world, image, aspect);
  const u = (image[LM.leftHip].x + image[LM.rightHip].x) / 2 - 0.5;
  const x = u * mpu;
  const depth = mpu * F_UNITS; // metres from camera
  const z = -depth;

  let conf = 0;
  for (const i of CORE_LMS) conf += image[i].visibility ?? 0;
  conf /= CORE_LMS.length;

  return {
    pose: { t, facing, x, z, hipY, bones, conf },
    lengths,
    hipWidth: len(hipVec),
    shoulderWidth: len(sub(J.rshoulder, J.lshoulder)),
    metresPerUnit: mpu,
    evidence: landmarkEvidence(world, image, aspect, mpu),
  };
}
