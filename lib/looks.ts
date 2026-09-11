/* ------------------------------------------------------------------
   Procedural looks: characters built from the figure itself.

   A VRM character is a downloaded file; a *look* is a small three.js
   rig assembled here from primitives at the dancer's own bone lengths
   and driven, like everything else, by forward kinematics — so it
   needs no download, no skinning, no retargeting, and it carries no
   costume: only the pose. Four styles:

     mannequin  a wooden artist's figure: ball joints, a lathed torso
     robot      plates and chrome, a visor that faces where the dancer faces
     glass      the mannequin's shapes in transmissive glass
     notation   every segment an arrow, coloured by side: the figure *is*
                the notation

   Identity follows the avatar convention (lib/avatars.ts): a look's url
   is `look:<id>`, and colourways are separate looks sharing a style.
   No React here; components/Avatar.tsx wraps `buildLook` in a frame loop.
   ------------------------------------------------------------------ */

import * as THREE from "three";
import type { Body } from "./fk";
import type { Vec3 } from "./geometry";
import { BONE, BONES, type BoneId, type JointId } from "./skeleton";

export type LookStyle = "mannequin" | "robot" | "glass" | "notation";

export interface FigureLook {
  id: string;
  label: string;
  style: LookStyle;
  /** The body colour (wood, metal, glass tint; the notation's centre line). */
  colour: string;
  /** A second colour: the mannequin's and robot's joints, the visor. */
  accent: string;
  hint: string;
}

export const LOOK_PREFIX = "look:";
export const isLookUrl = (url: string | null | undefined): url is string => !!url && url.startsWith(LOOK_PREFIX);
export const lookUrl = (id: string) => `${LOOK_PREFIX}${id}`;

export const FIGURE_LOOKS: FigureLook[] = [
  { id: "mannequin", label: "Mannequin", style: "mannequin", colour: "#c9a070", accent: "#8a6a44", hint: "A wooden artist's figure. No costume, only the pose." },
  { id: "ebony",     label: "Ebony",     style: "mannequin", colour: "#4a3128", accent: "#2d1d16", hint: "The mannequin in dark wood." },
  { id: "robot",     label: "Robot",     style: "robot",     colour: "#dfe3ea", accent: "#1c1f26", hint: "Chrome plates and dark joints; the visor faces where you face." },
  { id: "brass",     label: "Brass",     style: "robot",     colour: "#e0b25a", accent: "#2a2118", hint: "The robot in warm brass." },
  { id: "glass",     label: "Glass",     style: "glass",     colour: "#dfe9f5", accent: "#ffffff", hint: "A figure of glass: the stage shows through it." },
  { id: "sapphire",  label: "Sapphire",  style: "glass",     colour: "#8cc4ff", accent: "#2a6fd6", hint: "Blue glass." },
  { id: "notation",  label: "Notation",  style: "notation",  colour: "#f0b429", accent: "#eef0f4", hint: "Every limb an arrow, left blue, right pink: the figure is the notation." },
];

export const figureLook = (url: string | null | undefined): FigureLook | undefined =>
  isLookUrl(url) ? FIGURE_LOOKS.find((l) => l.id === url.slice(LOOK_PREFIX.length)) : undefined;

/** The same side colours as the stick figure and the traces. */
export const SIDE_COLOURS = { L: "#4cc9f0", R: "#f72585", C: "#b8c0d0" } as const;

/** A built look: add `group` to the scene, call `update` every frame. */
export interface LookRig {
  group: THREE.Group;
  /** Place every part from the joint positions; `facing` (degrees) turns whatever has a face. */
  update(J: Record<JointId, Vec3>, facing: number): void;
  dispose(): void;
}

/* ---------- placing helpers (shared scratch, no allocation per frame) ---------- */

type Joints = Record<JointId, Vec3>;
type Placer = (J: Joints, facing: number) => void;

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

const vec = (v: Vec3, out: THREE.Vector3) => out.set(v.x, v.y, v.z);

/** `obj`'s local +y runs from `a` to `b`; it sits at the midpoint, or at `a`. */
function alongSegment(obj: THREE.Object3D, a: Vec3, b: Vec3, at: "mid" | "start" = "mid") {
  vec(a, _a); vec(b, _b);
  _d.subVectors(_b, _a);
  if (_d.lengthSq() < 1e-10) _d.copy(UP); else _d.normalize();
  obj.quaternion.setFromUnitVectors(UP, _d);
  if (at === "mid") obj.position.addVectors(_a, _b).multiplyScalar(0.5);
  else obj.position.copy(_a);
}

/**
 * A full basis for `obj`: local +y from `yFrom` to `yTo`, local +x along
 * `xFrom`→`xTo` (made orthogonal), local +z = x × y. With x running from
 * the dancer's right joint to their left, local +z is the dancer's forward.
 */
function alongBasis(obj: THREE.Object3D, origin: Vec3, yFrom: Vec3, yTo: Vec3, xFrom: Vec3, xTo: Vec3) {
  vec(yFrom, _a); vec(yTo, _b);
  _y.subVectors(_b, _a);
  if (_y.lengthSq() < 1e-10) _y.copy(UP); else _y.normalize();
  vec(xFrom, _a); vec(xTo, _b);
  _x.subVectors(_b, _a);
  _x.addScaledVector(_y, -_x.dot(_y));
  if (_x.lengthSq() < 1e-10) { _x.set(1, 0, 0); _x.addScaledVector(_y, -_x.dot(_y)); }
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  vec(origin, obj.position);
}

/** A foot: flat on its sole, local +z from the ankle towards the toe. */
function alongFoot(obj: THREE.Object3D, ankle: Vec3, toe: Vec3) {
  vec(ankle, _a); vec(toe, _b);
  _z.subVectors(_b, _a); if (_z.lengthSq() < 1e-10) _z.set(0, 0, 1); _z.normalize();
  _x.crossVectors(UP, _z); if (_x.lengthSq() < 1e-10) _x.set(1, 0, 0); _x.normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(_a);
}

/** Forward on the stage for a facing in degrees (lib/fk.ts). */
function facingVec(deg: number, out: THREE.Vector3) {
  const phi = deg * (Math.PI / 180);
  return out.set(Math.sin(phi), 0, Math.cos(phi));
}

/* ---------- materials ---------- */

function bodyMaterial(look: FigureLook): THREE.Material {
  switch (look.style) {
    case "mannequin": return new THREE.MeshStandardMaterial({ color: look.colour, roughness: 0.55, metalness: 0, envMapIntensity: 0.5 });
    // Pure metal has no diffuse and turns into a grey mirror of the room; a little diffuse keeps the plates readable.
    case "robot":     return new THREE.MeshStandardMaterial({ color: look.colour, roughness: 0.28, metalness: 0.75, envMapIntensity: 1.6 });
    // Glass on a dark stage is mostly what it reflects, so the room is turned up and the body given a faint tinted depth.
    // Glass on a dark stage is mostly what it reflects, so the room is turned up and the body lit faintly from within.
    case "glass":     return new THREE.MeshPhysicalMaterial({
      color: look.colour, transmission: 0.92, thickness: 0.5, roughness: 0.1, ior: 1.5, metalness: 0, envMapIntensity: 2.5,
      attenuationColor: new THREE.Color(look.colour), attenuationDistance: look.id === "glass" ? 1.2 : 0.5,
      emissive: new THREE.Color(look.colour), emissiveIntensity: 0.14,
      iridescence: 0.4, iridescenceIOR: 1.3, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.05,
    });
    case "notation":  return new THREE.MeshStandardMaterial({ color: look.colour, roughness: 0.45, metalness: 0, envMapIntensity: 0.5 });
  }
}

function accentMaterial(look: FigureLook): THREE.Material {
  switch (look.style) {
    case "mannequin": return new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.6, metalness: 0 });
    case "robot":     return new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.45, metalness: 0.8 });
    case "glass":     return new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.5 });
    case "notation":  return new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.5, metalness: 0 });
  }
}

/* ---------- proportions ---------- */

/** Limb radius, metres: a body of ordinary build. */
const LIMB_RADIUS: Record<string, number> = {
  ruarm: 0.045, luarm: 0.045, rfarm: 0.038, lfarm: 0.038,
  rthigh: 0.066, lthigh: 0.066, rshin: 0.05, lshin: 0.05,
};
const LIMBS: BoneId[] = ["ruarm", "rfarm", "luarm", "lfarm", "rthigh", "rshin", "lthigh", "lshin"];
const HANDS: BoneId[] = ["rhand", "lhand"];
const FEET: BoneId[] = ["rfoot", "lfoot"];
/** Joints that get a ball: shoulders, elbows, wrists, hips, knees, ankles. */
const BALL_JOINTS: [JointId, number][] = [
  ["rshoulder", 0.05], ["lshoulder", 0.05], ["relbow", 0.042], ["lelbow", 0.042], ["rwrist", 0.035], ["lwrist", 0.035],
  ["rhip", 0.06], ["lhip", 0.06], ["rknee", 0.056], ["lknee", 0.056], ["rankle", 0.045], ["lankle", 0.045],
];
const NECK_RADIUS = 0.04;

/** The torso as a lathe: hips → waist → chest → shoulders, flattened front to back. */
function torsoGeometry(body: Body): THREE.BufferGeometry {
  const L = body.lengths.torso, hip = body.hipWidth / 2, sh = body.shoulderWidth / 2;
  const profile: [number, number][] = [
    [hip * 0.55, -0.06], [hip * 1.05, 0], [hip * 1.08, 0.12], [hip * 0.88, 0.42], [sh * 0.82, 0.78], [sh * 0.9, 0.92], [sh * 0.7, 1], [sh * 0.35, 1.04],
  ];
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y * L)), 28);
  g.scale(1, 1, 0.62);
  return g;
}

function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.1, 24, 18);
  g.scale(0.92, 1.12, 1);
  return g;
}

const capsule = (r: number, L: number) => new THREE.CapsuleGeometry(r, Math.max(0.01, L - 1.2 * r), 6, 14);

function footGeometry(L: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.075, 0.05, L * 1.15);
  g.translate(0, -0.005, L * 0.28); // the heel sits a little behind the ankle
  return g;
}

function handGeometry(L: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 14, 10);
  g.scale(0.032, L * 0.6, 0.05);
  g.translate(0, L * 0.5, 0);
  return g;
}

/**
 * Build the rig for a look at a body's bone lengths. Geometry is sized
 * once here (a bone's length never changes within a dance); `update`
 * then only moves and turns the parts.
 */
export function buildLook(look: FigureLook, body: Body): LookRig {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const placers: Placer[] = [];
  const material = (m: THREE.Material) => { mats.push(m); return m; };
  /** A mesh in the group, with how to place it each frame. */
  const part = (geometry: THREE.BufferGeometry, mat: THREE.Material, place: (mesh: THREE.Mesh) => Placer) => {
    geos.push(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    placers.push(place(mesh));
    return mesh;
  };
  const len = (id: BoneId) => body.lengths[id] ?? BONE[id].len;
  const bodyMat = material(bodyMaterial(look));
  const accentMat = material(accentMaterial(look));

  if (look.style === "notation") {
    const side = { L: material(new THREE.MeshStandardMaterial({ color: SIDE_COLOURS.L, roughness: 0.45 })), R: material(new THREE.MeshStandardMaterial({ color: SIDE_COLOURS.R, roughness: 0.45 })), C: bodyMat };
    for (const b of BONES) {
      const L = len(b.id);
      if (b.id === "shoulders") { // the shoulder line is a frame, not a direction: a plain bar
        part(new THREE.CylinderGeometry(0.008, 0.008, Math.max(0.02, body.shoulderWidth), 8), bodyMat, (m) => (J) => alongSegment(m, J.lshoulder, J.rshoulder));
        continue;
      }
      const headLen = Math.min(b.core ? 0.075 : 0.05, L * 0.45);
      const shaftR = b.core ? 0.011 : 0.007;
      const shaft = new THREE.CylinderGeometry(shaftR, shaftR, Math.max(0.01, L - headLen), 8);
      shaft.translate(0, (L - headLen) / 2, 0);
      const cone = new THREE.ConeGeometry(b.core ? 0.03 : 0.02, headLen, 12);
      cone.translate(0, L - headLen / 2, 0);
      part(shaft, side[b.side], (m) => (J) => alongSegment(m, J[b.from], J[b.to], "start"));
      part(cone, side[b.side], (m) => (J) => alongSegment(m, J[b.from], J[b.to], "start"));
    }
    // The hip line is the frame the directions are read in.
    part(new THREE.CylinderGeometry(0.008, 0.008, Math.max(0.02, body.hipWidth), 8), bodyMat, (m) => (J) => alongSegment(m, J.lhip, J.rhip));
    for (const joint of ["hipMid", "shoulderMid", "relbow", "lelbow", "rknee", "lknee", "rwrist", "lwrist", "rankle", "lankle", "rshoulder", "lshoulder", "rhip", "lhip"] as JointId[]) {
      part(new THREE.SphereGeometry(0.018, 10, 8), accentMat, (m) => (J) => { vec(J[joint], m.position); });
    }
    // A small head so the figure reads as a person, not a diagram.
    part(new THREE.SphereGeometry(0.06, 16, 12), accentMat, (m) => (J) => { vec(J.headTop, m.position).y += 0.03; });
  } else if (look.style === "robot") {
    const T = len("torso"), hip = body.hipWidth, sh = body.shoulderWidth;
    // Chest and pelvis plates with a dark spine between them.
    part(new THREE.BoxGeometry(sh * 0.92, T * 0.5, 0.2), bodyMat, (m) => (J) => { alongBasis(m, J.hipMid, J.hipMid, J.shoulderMid, J.rshoulder, J.lshoulder); m.translateY(T * 0.72); });
    part(new THREE.BoxGeometry(hip * 1.15, T * 0.26, 0.17), bodyMat, (m) => (J) => { alongBasis(m, J.hipMid, J.hipMid, J.shoulderMid, J.rhip, J.lhip); m.translateY(T * 0.1); });
    part(new THREE.CylinderGeometry(0.035, 0.045, T * 0.36, 10), accentMat, (m) => (J) => { alongBasis(m, J.hipMid, J.hipMid, J.shoulderMid, J.rshoulder, J.lshoulder); m.translateY(T * 0.36); });
    // Head: a box with a visor on its face and an antenna; all placed by the head's basis (local +z = forward).
    const onHead = (m: THREE.Mesh): Placer => (J) => alongBasis(m, J.headTop, J.shoulderMid, J.headTop, J.rshoulder, J.lshoulder);
    const headG = new THREE.BoxGeometry(0.17, 0.2, 0.18); headG.translate(0, 0.005, 0);
    part(headG, bodyMat, onHead);
    const visorG = new THREE.BoxGeometry(0.13, 0.045, 0.02); visorG.translate(0, 0.03, 0.085);
    part(visorG, accentMat, onHead);
    const antennaG = new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6); antennaG.translate(0.05, 0.145, 0);
    part(antennaG, accentMat, onHead);
    const tipG = new THREE.SphereGeometry(0.014, 8, 6); tipG.translate(0.05, 0.185, 0);
    part(tipG, accentMat, onHead);
    part(new THREE.CylinderGeometry(0.035, 0.04, Math.max(0.02, len("head") - 0.07), 10), accentMat, (m) => (J) => alongSegment(m, J.shoulderMid, J.headTop));
    // Limbs as plates: a box the length of the bone, a little slimmer than the capsules.
    for (const id of LIMBS) {
      const b = BONE[id], r = LIMB_RADIUS[id] * 0.92;
      part(new THREE.BoxGeometry(r * 2, Math.max(0.02, len(id) - r * 1.2), r * 1.8), bodyMat, (m) => (J) => alongSegment(m, J[b.from], J[b.to]));
    }
    for (const [joint, r] of BALL_JOINTS) part(new THREE.SphereGeometry(r * 0.95, 14, 10), accentMat, (m) => (J) => { vec(J[joint], m.position); });
    for (const id of HANDS) {
      const b = BONE[id], L = len(id);
      const g = new THREE.BoxGeometry(0.06, L * 0.9, 0.028); g.translate(0, L * 0.45, 0);
      part(g, bodyMat, (m) => (J) => alongBasis(m, J[b.from], J[b.from], J[b.to], J.rshoulder, J.lshoulder));
    }
    for (const id of FEET) {
      const b = BONE[id];
      part(footGeometry(len(id)), bodyMat, (m) => (J) => alongFoot(m, J[b.from], J[b.to]));
    }
  } else {
    /* mannequin and glass: the same organic shapes */
    part(torsoGeometry(body), bodyMat, (m) => (J) => alongBasis(m, J.hipMid, J.hipMid, J.shoulderMid, J.rshoulder, J.lshoulder));
    part(headGeometry(), bodyMat, (m) => (J, facing) => {
      alongBasis(m, J.headTop, J.shoulderMid, J.headTop, J.rshoulder, J.lshoulder);
      // The tracked head point is between the ears; the skull sits a touch forward and up of it.
      m.position.addScaledVector(facingVec(facing, _d), 0.012).y += 0.015;
    });
    part(new THREE.CylinderGeometry(NECK_RADIUS, NECK_RADIUS * 1.15, Math.max(0.02, len("head") - 0.06), 12), bodyMat, (m) => (J) => alongSegment(m, J.shoulderMid, J.headTop));
    for (const id of LIMBS) {
      const b = BONE[id];
      part(capsule(LIMB_RADIUS[id], len(id)), bodyMat, (m) => (J) => alongSegment(m, J[b.from], J[b.to]));
    }
    for (const id of HANDS) {
      const b = BONE[id];
      part(handGeometry(len(id)), bodyMat, (m) => (J) => alongBasis(m, J[b.from], J[b.from], J[b.to], J.rshoulder, J.lshoulder));
    }
    for (const id of FEET) {
      const b = BONE[id];
      part(footGeometry(len(id)), bodyMat, (m) => (J) => alongFoot(m, J[b.from], J[b.to]));
    }
    if (look.style === "mannequin") {
      for (const [joint, r] of BALL_JOINTS) part(new THREE.SphereGeometry(r, 16, 12), accentMat, (m) => (J) => { vec(J[joint], m.position); });
    }
  }

  return {
    group,
    update(J, facing) { for (const p of placers) p(J, facing); },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      group.clear();
    },
  };
}
