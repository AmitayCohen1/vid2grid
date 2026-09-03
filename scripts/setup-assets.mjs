// Copies the MediaPipe WASM runtime out of node_modules and fetches the pose
// model into public/, so the tracker is fully self-hosted. Runs on postinstall.
import { cpSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = join(root, "public/mediapipe/wasm");
const modelDst = join(root, "public/models/pose_landmarker_full.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
// Sample avatar: the three-vrm example character (pixiv/three-vrm, MIT-licensed repo).
const avatarDst = join(root, "public/models/avatar.vrm");
const AVATAR_URL =
  "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm";

mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });
console.log("[assets] MediaPipe wasm →", wasmDst);

if (!existsSync(modelDst) || statSync(modelDst).size < 1_000_000) {
  mkdirSync(dirname(modelDst), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
  console.log("[assets] pose model →", modelDst);
} else {
  console.log("[assets] pose model present");
}

if (!existsSync(avatarDst) || statSync(avatarDst).size < 1_000_000) {
  mkdirSync(dirname(avatarDst), { recursive: true });
  const res = await fetch(AVATAR_URL);
  if (!res.ok) throw new Error(`avatar download failed: ${res.status}`);
  writeFileSync(avatarDst, Buffer.from(await res.arrayBuffer()));
  console.log("[assets] sample avatar →", avatarDst);
} else {
  console.log("[assets] sample avatar present");
}
