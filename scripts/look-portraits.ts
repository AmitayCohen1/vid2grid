/* ------------------------------------------------------------------
   Portraits and turnaround sheets for the procedural looks
   (lib/looks.ts) — the same framing, pose, lights and floor disc as
   the VRM characters' pre-rendered stills in public/avatars, so the
   tiles sit together. Runs in a browser; needs no server.

     npx esbuild scripts/look-portraits.ts --bundle --format=iife --outfile=/tmp/look-portraits.js
     # then in Playwright (real Chrome, WebGL on):
     #   page.goto("about:blank"); page.addScriptTag({ path: "/tmp/look-portraits.js" });
     #   portrait = await page.evaluate((id) => window.__lookPortrait(id), "mannequin")   // data URL, 480×640
     #   sheet    = await page.evaluate((id) => window.__lookSheet(id), "mannequin")      // data URL, 2880×160
     # and write both as public/avatars/look-<id>.png and look-<id>-turn.png.
   ------------------------------------------------------------------ */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FIGURE_LOOKS, buildLook } from "../lib/looks";
import { DEFAULT_BODY, forwardKinematics } from "../lib/fk";
import { TURN_FRAMES } from "../lib/avatars";
import type { Pose } from "../lib/pose";
import type { BoneId } from "../lib/skeleton";
import type { AzEl } from "../lib/geometry";

declare global {
  interface Window { __lookPortrait: (id: string) => string; __lookSheet: (id: string) => string }
}

/** A relaxed A-pose: arms down and a little out, weight even, looking at the camera. */
const A_POSE: Pose = {
  t: 0, facing: 0, x: 0, z: 0, hipY: DEFAULT_BODY.lengths.rthigh + DEFAULT_BODY.lengths.rshin + 0.08, conf: 1,
  bones: {
    torso: [0, 88], shoulders: [90, 0], head: [0, 86],
    ruarm: [95, -62], rfarm: [92, -70], rhand: [92, -74],
    luarm: [265, -62], lfarm: [268, -70], lhand: [268, -74],
    rthigh: [100, -86], rshin: [90, -88], rfoot: [10, -8],
    lthigh: [260, -86], lshin: [270, -88], lfoot: [350, -8],
  } as Record<BoneId, AzEl>,
};

function scene(w: number, h: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x131418);
  const pmrem = new THREE.PMREMGenerator(renderer);
  sc.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  sc.environmentIntensity = 0.55;
  sc.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1.5, 2.5, 3); sc.add(key);
  const rim = new THREE.DirectionalLight(0x9aa8ff, 0.7); rim.position.set(-2, 1.5, -2); sc.add(rim);
  const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 50);
  return { renderer, sc, camera };
}

function figure(id: string) {
  const look = FIGURE_LOOKS.find((l) => l.id === id);
  if (!look) throw new Error(`no look ${id}`);
  const rig = buildLook(look, DEFAULT_BODY);
  const J = forwardKinematics(A_POSE, DEFAULT_BODY);
  rig.update(J, 0);
  rig.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.group);
  return { rig, floorY: box.min.y, centre: box.getCenter(new THREE.Vector3()), headY: J.headTop.y };
}

function dress(sc: THREE.Scene, camera: THREE.PerspectiveCamera, f: ReturnType<typeof figure>) {
  const { floorY, centre: c0, headY } = f;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 64), new THREE.MeshBasicMaterial({ color: 0x1b1c22 }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(c0.x, floorY + 0.001, c0.z); sc.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.62, 64), new THREE.MeshBasicMaterial({ color: 0x3a3d47 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(c0.x, floorY + 0.002, c0.z); sc.add(ring);
  const top = headY + 0.30, bottom = floorY - 0.12;
  const mid = (top + bottom) / 2, span = top - bottom;
  const dist = (span / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.06;
  camera.position.set(c0.x, mid + 0.30, c0.z + dist);
  camera.lookAt(c0.x, mid - 0.02, c0.z);
}

window.__lookPortrait = (id) => {
  const { renderer, sc, camera } = scene(480, 640);
  const f = figure(id);
  sc.add(f.rig.group);
  dress(sc, camera, f);
  renderer.render(sc, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
};

window.__lookSheet = (id) => {
  const W = 120, H = 160;
  const { renderer, sc, camera } = scene(W, H);
  const f = figure(id);
  // Turn about the figure's own centre line, with two light bobs per turn (as the VRM sheets do).
  const pivot = new THREE.Group();
  f.rig.group.position.set(-f.centre.x, 0, -f.centre.z);
  pivot.add(f.rig.group); pivot.position.set(f.centre.x, 0, f.centre.z); sc.add(pivot);
  dress(sc, camera, f);
  const sheet = document.createElement("canvas"); sheet.width = W * TURN_FRAMES; sheet.height = H;
  const ctx = sheet.getContext("2d")!;
  for (let i = 0; i < TURN_FRAMES; i++) {
    const t = i / TURN_FRAMES;
    pivot.rotation.y = t * Math.PI * 2;
    pivot.position.y = Math.sin(t * Math.PI * 4) * 0.012;
    renderer.render(sc, camera);
    ctx.drawImage(renderer.domElement, i * W, 0);
  }
  renderer.dispose();
  return sheet.toDataURL("image/png");
};
