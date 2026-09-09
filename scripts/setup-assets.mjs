// Copies the MediaPipe WASM runtime out of node_modules and fetches the pose
// model and the preset characters into public/, so everything is self-hosted.
// Characters are then shrunk for the web (scripts/optimize-vrm.mjs): a VRoid
// sample is 10–20 MB of mostly 2048² textures, a quarter of that after.
// Runs on postinstall. Files are served immutable (next.config.ts), so a
// changed character needs a new file name.
import { cpSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { optimizeFile } from "./optimize-vrm.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = join(root, "public/mediapipe/wasm");
const modelDst = join(root, "public/models/pose_landmarker_full.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
// Preset characters. Sources and licenses:
// - avatar.vrm: three-vrm example character (pixiv/three-vrm, MIT-licensed repo).
// - seed-san.vrm: official VRM specification sample model (vrm-c/vrm-specification).
// - vroid-{a,b,c}.vrm: VRoid Studio sample models (pixiv) — freely usable/alterable
//   under their conditions of use: https://vroid.pixiv.help/hc/en-us/articles/4402394424089
// - vivi/shibu/fumiriya.vrm: VRoid Studio beta sample models (Vivi,
//   Darkness Shibu, Sakurada Fumiriya), released under CC0:
//   https://vroid.pixiv.help/hc/en-us/articles/4402614652569
// - hair-male.vrm: VRoid Studio beta sample "HairSample_Male", CC0 (same page). Three
//   presets share it (Sora, Kai, Ren) — the latter two are tinted at load, see lib/avatars.ts.
const AVATARS = [
  ["avatar.vrm", "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm"],
  ["seed-san.vrm", "https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-san/vrm/Seed-san.vrm"],
  ["vroid-a.vrm", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_A.vrm"],
  ["vroid-b.vrm", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_B.vrm"],
  ["vroid-c.vrm", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_C.vrm"],
  ["vivi.vrm", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Vivi.vrm"],
  ["shibu.vrm", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Darkness_Shibu.vrm"],
  ["fumiriya.vrm", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sakurada_Fumiriya.vrm"],
  ["hair-male.vrm", "https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/HairSample_Male.vrm"],
];

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

for (const [file, url] of AVATARS) {
  const dst = join(root, "public/models", file);
  if (!existsSync(dst) || statSync(dst).size < 1_000_000) {
    mkdirSync(dirname(dst), { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`avatar download failed (${file}): ${res.status}`);
    writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
    console.log("[assets] avatar →", dst);
  } else {
    console.log("[assets] avatar present:", file);
  }
  const [before, after] = await optimizeFile(dst);
  if (after !== before) console.log(`[assets] avatar shrunk: ${file} ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
}
