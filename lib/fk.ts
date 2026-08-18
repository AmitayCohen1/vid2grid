/* ------------------------------------------------------------------
   Forward kinematics: a Pose (directions + lengths) → joint positions
   on the stage, ready to draw.
   ------------------------------------------------------------------ */

import { type Vec3, add, fromAzEl, scale, v3 } from "./geometry";
import { BONE, FK_ORDER, type BoneId, type JointId } from "./skeleton";
import type { Pose } from "./pose";

export interface Body {
  lengths: Record<BoneId, number>;
  hipWidth: number;
  shoulderWidth: number;
}

export const DEFAULT_BODY: Body = {
  lengths: Object.fromEntries(Object.values(BONE).map((b) => [b.id, b.len])) as Record<BoneId, number>,
  hipWidth: 0.22,
  shoulderWidth: 0.36,
};

/** Joint positions in stage space (x = audience's right, y = up, z = towards audience). */
export function forwardKinematics(pose: Pose, body: Body): Record<JointId, Vec3> {
  const phi = pose.facing * (Math.PI / 180);
  // Dancer's frame on stage: forward F, up U, right R = F × U.
  const F = v3(Math.sin(phi), 0, Math.cos(phi));
  const U = v3(0, 1, 0);
  const R = v3(-Math.cos(phi), 0, Math.sin(phi));
  const toStage = (local: Vec3): Vec3 => ({
    x: local.x * R.x + local.y * U.x + local.z * F.x,
    y: local.x * R.y + local.y * U.y + local.z * F.y,
    z: local.x * R.z + local.y * U.z + local.z * F.z,
  });

  const root = v3(pose.x, pose.hipY, pose.z);
  const J = {} as Record<JointId, Vec3>;
  J.hipMid = root;
  J.lhip = add(root, toStage(v3(-body.hipWidth / 2, 0, 0)));
  J.rhip = add(root, toStage(v3(body.hipWidth / 2, 0, 0)));

  for (const id of FK_ORDER) {
    const b = BONE[id];
    const dir = toStage(fromAzEl(pose.bones[id]));
    const L = body.lengths[id] ?? b.len;
    if (id === "shoulders") {
      // The shoulder line is centred on the top of the torso.
      const c = J.shoulderMid;
      J.lshoulder = add(c, scale(dir, -body.shoulderWidth / 2));
      J.rshoulder = add(c, scale(dir, body.shoulderWidth / 2));
      continue;
    }
    J[b.to] = add(J[b.from], scale(dir, L));
  }
  return J;
}
