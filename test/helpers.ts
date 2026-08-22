import type { Pose } from "../lib/pose";
import { BONE_IDS } from "../lib/skeleton";
import type { AzEl } from "../lib/geometry";

export function mkPose(t: number, az = 0): Pose {
  const bones = Object.fromEntries(BONE_IDS.map((id) => [id, [az, -45] as AzEl])) as Pose["bones"];
  return { t, facing: 350, x: 0.1, z: -0.2, hipY: 0.95, bones, conf: 0.9 };
}
