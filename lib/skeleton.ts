/* ------------------------------------------------------------------
   The figure: a tree of segments. Each segment is a direction on the
   sphere in body-local space, plus a length. The hip line is the
   frame itself (it defines "right"), so it is not a segment.
   ------------------------------------------------------------------ */

export type BoneId =
  | "torso" | "shoulders" | "head"
  | "ruarm" | "rfarm" | "rhand"
  | "luarm" | "lfarm" | "lhand"
  | "rthigh" | "rshin" | "rfoot"
  | "lthigh" | "lshin" | "lfoot";

export type JointId =
  | "hipMid" | "lhip" | "rhip"
  | "shoulderMid" | "lshoulder" | "rshoulder" | "headTop"
  | "relbow" | "rwrist" | "rhandTip"
  | "lelbow" | "lwrist" | "lhandTip"
  | "rknee" | "rankle" | "rtoe"
  | "lknee" | "lankle" | "ltoe";

export interface BoneDef {
  id: BoneId;
  label: string;
  short: string;
  /** Joint the segment starts from and ends at (for forward kinematics). */
  from: JointId;
  to: JointId;
  /** Core segments are what the notations record; extremities are extras. */
  core: boolean;
  side: "L" | "R" | "C";
  /** Default length in metres (overridden by measured lengths). */
  len: number;
}

export const BONES: BoneDef[] = [
  { id: "torso",     label: "Torso",         short: "TOR", from: "hipMid",      to: "shoulderMid", core: true,  side: "C", len: 0.48 },
  { id: "shoulders", label: "Shoulder line", short: "SHL", from: "lshoulder",   to: "rshoulder",   core: false, side: "C", len: 0.36 },
  { id: "head",      label: "Head",          short: "HED", from: "shoulderMid", to: "headTop",     core: true,  side: "C", len: 0.24 },
  { id: "ruarm",     label: "R upper arm",   short: "RUA", from: "rshoulder",   to: "relbow",      core: true,  side: "R", len: 0.28 },
  { id: "rfarm",     label: "R forearm",     short: "RFA", from: "relbow",      to: "rwrist",      core: true,  side: "R", len: 0.26 },
  { id: "rhand",     label: "R hand",        short: "RHA", from: "rwrist",      to: "rhandTip",    core: false, side: "R", len: 0.10 },
  { id: "luarm",     label: "L upper arm",   short: "LUA", from: "lshoulder",   to: "lelbow",      core: true,  side: "L", len: 0.28 },
  { id: "lfarm",     label: "L forearm",     short: "LFA", from: "lelbow",      to: "lwrist",      core: true,  side: "L", len: 0.26 },
  { id: "lhand",     label: "L hand",        short: "LHA", from: "lwrist",      to: "lhandTip",    core: false, side: "L", len: 0.10 },
  { id: "rthigh",    label: "R thigh",       short: "RTH", from: "rhip",        to: "rknee",       core: true,  side: "R", len: 0.44 },
  { id: "rshin",     label: "R shin",        short: "RSH", from: "rknee",       to: "rankle",      core: true,  side: "R", len: 0.42 },
  { id: "rfoot",     label: "R foot",        short: "RFT", from: "rankle",      to: "rtoe",        core: false, side: "R", len: 0.16 },
  { id: "lthigh",    label: "L thigh",       short: "LTH", from: "lhip",        to: "lknee",       core: true,  side: "L", len: 0.44 },
  { id: "lshin",     label: "L shin",        short: "LSH", from: "lknee",       to: "lankle",      core: true,  side: "L", len: 0.42 },
  { id: "lfoot",     label: "L foot",        short: "LFT", from: "lankle",      to: "ltoe",        core: false, side: "L", len: 0.16 },
];

export const BONE_IDS = BONES.map((b) => b.id);
export const BONE = Object.fromEntries(BONES.map((b) => [b.id, b])) as Record<BoneId, BoneDef>;

/** Order in which segments must be resolved so parents exist first. */
export const FK_ORDER: BoneId[] = [
  "torso", "shoulders", "head",
  "ruarm", "rfarm", "rhand",
  "luarm", "lfarm", "lhand",
  "rthigh", "rshin", "rfoot",
  "lthigh", "lshin", "lfoot",
];

/* MediaPipe Pose Landmarker — 33 landmarks. */
export const LM = {
  nose: 0,
  leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3,
  rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
  leftEar: 7, rightEar: 8,
  mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18,
  leftIndex: 19, rightIndex: 20,
  leftThumb: 21, rightThumb: 22,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
} as const;

/** Landmark pairs to draw for the 2D overlay. */
export const LM_EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [15, 19], [15, 17], [16, 20], [16, 18],
  [7, 8], [0, 7], [0, 8],
];
