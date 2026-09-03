"use client";

/* ------------------------------------------------------------------
   A skinned character driven by the score.

   The score stores directions, not rotations, so this is a small
   retargeter: for each tracked segment we aim the matching VRM
   humanoid bone so its rest "tip" direction lines up with the
   segment's stage-space direction (minimal rotation, parents first —
   the same idea as Figure's setFromUnitVectors, applied to a rig).
   Twist about the segment axis is not recorded and stays neutral;
   untracked bones (fingers, face) stay in rest pose.
   ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type VRM, VRMLoaderPlugin, VRMUtils, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { forwardKinematics, type Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
import type { JointId } from "@/lib/skeleton";

/** The bundled sample character; any VRoid/VRM 0.x or 1.0 file can replace it. */
export const DEFAULT_AVATAR_URL = "/models/avatar.vrm";

/** Bundled roster (fetched by scripts/setup-assets.mjs; see it for sources/licenses). */
export const AVATAR_PRESETS: { label: string; url: string }[] = [
  { label: "three-vrm", url: DEFAULT_AVATAR_URL },
  { label: "Seed-san", url: "/models/seed-san.vrm" },
  { label: "VRoid A", url: "/models/vroid-a.vrm" },
  { label: "VRoid B", url: "/models/vroid-b.vrm" },
  { label: "VRoid C", url: "/models/vroid-c.vrm" },
];

const UP = new THREE.Vector3(0, 1, 0);

/** Segment → humanoid bone, parents before children. `tip` defines the
 *  bone's rest direction (bone joint → tip joint); optional tips fall
 *  back per chain below. */
const CHAINS: { bone: VRMHumanBoneName; tip: VRMHumanBoneName; from: JointId; to: JointId }[] = [
  { bone: "spine",         tip: "neck",              from: "hipMid",      to: "shoulderMid" },
  { bone: "neck",          tip: "head",              from: "shoulderMid", to: "headTop" },
  { bone: "leftUpperArm",  tip: "leftLowerArm",      from: "lshoulder",   to: "lelbow" },
  { bone: "leftLowerArm",  tip: "leftHand",          from: "lelbow",      to: "lwrist" },
  { bone: "leftHand",      tip: "leftMiddleProximal", from: "lwrist",     to: "lhandTip" },
  { bone: "rightUpperArm", tip: "rightLowerArm",     from: "rshoulder",   to: "relbow" },
  { bone: "rightLowerArm", tip: "rightHand",         from: "relbow",      to: "rwrist" },
  { bone: "rightHand",     tip: "rightMiddleProximal", from: "rwrist",    to: "rhandTip" },
  { bone: "leftUpperLeg",  tip: "leftLowerLeg",      from: "lhip",        to: "lknee" },
  { bone: "leftLowerLeg",  tip: "leftFoot",          from: "lknee",       to: "lankle" },
  { bone: "leftFoot",      tip: "leftToes",          from: "lankle",      to: "ltoe" },
  { bone: "rightUpperLeg", tip: "rightLowerLeg",     from: "rhip",        to: "rknee" },
  { bone: "rightLowerLeg", tip: "rightFoot",         from: "rknee",       to: "rankle" },
  { bone: "rightFoot",     tip: "rightToes",         from: "rankle",      to: "rtoe" },
];

interface Rig {
  vrm: VRM;
  /** Per chain: the normalized bone node and its rest direction (world,
   *  which equals model space — the scene itself is never rotated). */
  chains: { node: THREE.Object3D; rest: THREE.Vector3; from: JointId; to: JointId }[];
  hips: THREE.Object3D;
  hipsRest: THREE.Vector3;
  /** Which way the model faces at rest (unit, horizontal). */
  restForward: THREE.Vector3;
}

const rigCache = new Map<string, Promise<Rig>>();

function loadRig(url: string): Promise<Rig> {
  const cached = rigCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // no-op for VRM 1.0; makes 0.x face +z like 1.0
    vrm.scene.traverse((o) => { o.frustumCulled = false; });

    /* Measure the rest pose instead of assuming conventions. */
    const humanoid = vrm.humanoid;
    humanoid.resetNormalizedPose();
    const pos = (name: VRMHumanBoneName) => {
      const n = humanoid.getNormalizedBoneNode(name);
      return n ? n.getWorldPosition(new THREE.Vector3()) : null;
    };
    const hips = humanoid.getNormalizedBoneNode("hips")!;
    const hipsRest = hips.getWorldPosition(new THREE.Vector3());
    // Model frame from the hip line, same convention as lib/fk.ts (R = F × U ⇒ F = U × R).
    const right = pos("rightUpperLeg")!.sub(pos("leftUpperLeg")!).setY(0).normalize();
    const restForward = new THREE.Vector3().crossVectors(UP, right).normalize();

    const chains: Rig["chains"] = [];
    for (const c of CHAINS) {
      const node = humanoid.getNormalizedBoneNode(c.bone);
      if (!node) continue;
      const tip = pos(c.tip);
      const origin = node.getWorldPosition(new THREE.Vector3());
      // Feet without toe bones point forward at rest; other missing tips skip the chain.
      const rest = tip ? tip.sub(origin).normalize()
        : c.bone.endsWith("Foot") ? restForward.clone()
        : null;
      if (rest) chains.push({ node, rest, from: c.from, to: c.to });
    }
    return { vrm, chains, hips, hipsRest, restForward };
  })();
  rigCache.set(url, p);
  p.catch(() => rigCache.delete(url)); // let a failed load be retried
  return p;
}

const _qp = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _cur = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _fwd = new THREE.Vector3();

function retarget(rig: Rig, pose: Pose, body: Body) {
  const { vrm, hips, hipsRest, restForward, chains } = rig;
  const J = forwardKinematics(pose, body);
  vrm.humanoid.resetNormalizedPose();

  // Match the dancer's standing hip height, then plant the hips.
  const legs = body.lengths.rthigh + body.lengths.rshin + 0.08;
  const s = THREE.MathUtils.clamp(legs / Math.max(0.2, hipsRest.y), 0.4, 2.5);
  vrm.scene.scale.setScalar(s);
  vrm.scene.position.set(
    J.hipMid.x - hipsRest.x * s,
    J.hipMid.y - hipsRest.y * s,
    J.hipMid.z - hipsRest.z * s,
  );

  // Facing: yaw the hips so the model's rest forward meets the dancer's.
  const phi = pose.facing * (Math.PI / 180);
  _fwd.set(Math.sin(phi), 0, Math.cos(phi));
  hips.quaternion.setFromUnitVectors(restForward, _fwd);

  // Aim each segment, parents first; the normalized rig has identity rest
  // rotations, so a bone's pre-aim world direction is just its rest
  // direction turned by the parent's (already final) world rotation.
  for (const c of chains) {
    const d = _tgt.set(J[c.to].x - J[c.from].x, J[c.to].y - J[c.from].y, J[c.to].z - J[c.from].z);
    if (d.lengthSq() < 1e-8) continue;
    d.normalize();
    c.node.parent!.getWorldQuaternion(_qp);
    _cur.copy(c.rest).applyQuaternion(_qp);
    _dq.setFromUnitVectors(_cur, d);
    c.node.quaternion.copy(_qp).invert().multiply(_dq).multiply(_qp);
  }
}

export default function Avatar({ pose, body, url = DEFAULT_AVATAR_URL }: { pose: Pose; body: Body; url?: string }) {
  const [loaded, setLoaded] = useState<{ url: string; rig: Rig } | null>(null);
  useEffect(() => {
    let alive = true;
    loadRig(url).then((rig) => { if (alive) setLoaded({ url, rig }); }).catch((e) => console.error("avatar load failed", e));
    return () => { alive = false; };
  }, [url]);
  // Only show the rig for the current url; a stale one just disappears while the new one loads.
  const rig = loaded?.url === url ? loaded.rig : null;

  useFrame((_, delta) => {
    if (!rig) return;
    retarget(rig, pose, body);
    rig.vrm.update(delta); // normalized → raw, constraints, spring bones
  });

  if (!rig) return null;
  return <primitive object={rig.vrm.scene} />;
}
