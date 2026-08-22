# Video Sections → Notation Choreography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tracked video becomes a ≤8-beat quarter-beat-quantized *section* saved to a browser IndexedDB library; danceforms.html sequences sections into a *choreography* with playback, finer-direction notation renderings, JSON export, and captured video.

**Architecture:** Section-making (tempo estimate, quantize, trim, save) lives in the vid2grid Next app (`lib/` engine modules + one React panel). The static pages `index.html` / `danceforms.html` are copied into `public/movement-languages/` and gain a Library drawer, Choreography builder, capture, and finer notation resolution. The two sides share one documented section format and one IndexedDB database; the static pages load a single shared script, the TS side has a small twin module.

**Tech Stack:** Next.js 16 / React 19 / TS (existing app) · vanilla JS single-file pages (existing) · IndexedDB · MediaRecorder · node:test + tsx + fake-indexeddb (new devDeps) · Playwright (e2e, new devDep).

**Spec:** `docs/superpowers/specs/2026-08-21-video-sections-choreography-design.md`. Three deviations discovered by reading the code, all reflected below:
1. The danceforms stage is a **2D canvas** (`#stageCanvas`), not SVG → video capture uses `canvas.captureStream()` directly (simpler than the spec's SVG-serialization path).
2. The Benesh view **already** places wrist/ankle signs from continuous skeleton positions and stores continuous vectors → its finer-directions upgrade is a verified no-op; the upgrade work is Laban (16 directions + level pins) and Eshkol-Wachman (22.5° edit steps).
3. index.html's 8-direction × 3-level vocabulary is its *event data model* (the page is definitionally the reduction — its footer says so) → it keeps 8×3; the library picker demonstrates the compression. Finer rendering lands in danceforms only.
4. The Section panel gets its own compact **beat strip** (beat lines + keyframe ticks + draggable window) instead of modifying `components/Timeline.tsx` — same visibility of fit, no risk to the existing seek logic.

## Global Constraints

- Everything runs in the browser; no API routes, no server storage (vid2grid CLAUDE.md).
- Branch: `movement-languages`. The originals in `Documents/movement-languages/` are never modified; the repo carries copies under `public/movement-languages/`.
- Static pages stay no-build single files except one shared `<script src="section-store.js">`.
- `lib/` modules contain no React (repo convention).
- Section format: `v: 1`; `beats` integer ≤ 8; `keys[].beat` multiples of **0.25** in `[0, beats)`; a key always at beat 0; pose = `{x, z, facing, hipY, bones}` with exactly the ten bone ids `torso head ruarm rfarm luarm lfarm rthigh rshin lthigh lshin`; angles continuous degrees, azimuth and facing wrapped to **[−180, 180)**; elevation in [−90, 90]. Consumers ignore unknown bone ids.
- IndexedDB: database `movement-languages`, version 1, stores `sections` and `choreographies`, both `keyPath: "id"`.
- New runtime dependencies: none. New devDependencies allowed: `tsx`, `fake-indexeddb`, `playwright`.
- Verification commands: `npx tsc --noEmit -p .` (ignore the Next-generated `LayoutProps` error until `next dev`/`build` has run), `npx eslint .`, `npm test`.
- Commit after every task. Co-author line per repo convention.

## File Structure

```
lib/sectionize.ts                    NEW  section/choreography types, validation, pose
                                          conversion, quarter-beat quantization
lib/tempo.ts                         NEW  motion-derived tempo estimation (pure)
lib/sectionsDb.ts                    NEW  IndexedDB helper (TS twin of section-store.js)
components/SectionPanel.tsx          NEW  tempo controls, beat strip, window, save UI
components/App.tsx                   MOD  section state, preview wiring, nav links
public/movement-languages/section-store.js   NEW  shared vanilla helper (UMD-ish)
public/movement-languages/danceforms.html    NEW  copy + Library/Choreography/capture/finer
public/movement-languages/index.html         NEW  copy + nav + library picker
test/sectionize.test.ts              NEW
test/tempo.test.ts                   NEW
test/sectionsDb.test.ts              NEW
test/section-store.test.mjs          NEW  pure parts of the shared script
scripts/e2e-sections.mjs             NEW  Playwright end-to-end
package.json                         MOD  devDeps + "test" script
README.md / CLAUDE.md                MOD  document the pipeline
```

---

### Task 1: Section format module + test harness

**Files:**
- Modify: `package.json`
- Create: `lib/sectionize.ts` (types/validation/conversion half)
- Test: `test/sectionize.test.ts`

**Interfaces:**
- Consumes: `Pose` from `lib/pose.ts`, `AzEl` from `lib/geometry.ts`.
- Produces (later tasks rely on these exact names):
  - `SECTION_BONE_IDS: readonly SectionBoneId[]`, `type SectionBoneId`
  - `interface SectionPose { x: number; z: number; facing: number; hipY: number; bones: Record<SectionBoneId, AzEl> }`
  - `interface SectionKey { beat: number; pose: SectionPose }`
  - `interface Section { v: 1; id: string; name: string; createdAt: number; tempo: number; beats: number; source: { file: string; startSec: number; endSec: number }; keys: SectionKey[] }`
  - `interface Choreography { v: 1; id: string; name: string; tempo: number; items: { sectionId: string; repeat: number }[] }`
  - `wrap180(deg: number): number` — wraps to [−180, 180)
  - `poseToSectionPose(p: Pose): SectionPose`
  - `validateSection(o: unknown): Section` — throws `Error` with a human message

- [ ] **Step 1: Add test tooling**

```bash
npm install -D tsx fake-indexeddb
```

In `package.json` scripts add:

```json
"test": "node --import tsx --test test/*.test.ts && node --test test/*.test.mjs"
```

(There are no `.test.mjs` files yet; create `test/section-store.test.mjs` in Task 6. Until then use `node --import tsx --test test/*.test.ts` manually if the glob errors — or create the file in this task as an empty placeholder with one trivial passing test and grow it in Task 6. Do the latter so `npm test` always works.)

- [ ] **Step 2: Write the failing test**

`test/helpers.ts` (plain helper — no `.test.` in the name, so the runner glob skips it and importing it never re-registers tests):

```ts
import type { Pose } from "../lib/pose";
import { BONE_IDS } from "../lib/skeleton";
import type { AzEl } from "../lib/geometry";

export function mkPose(t: number, az = 0): Pose {
  const bones = Object.fromEntries(BONE_IDS.map((id) => [id, [az, -45] as AzEl])) as Pose["bones"];
  return { t, facing: 350, x: 0.1, z: -0.2, hipY: 0.95, bones, conf: 0.9 };
}
```

`test/sectionize.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION_BONE_IDS, poseToSectionPose, validateSection, wrap180 } from "../lib/sectionize";
import { mkPose } from "./helpers";

test("wrap180 wraps into [-180,180)", () => {
  assert.equal(wrap180(0), 0);
  assert.equal(wrap180(190), -170);
  assert.equal(wrap180(-190), 170);
  assert.equal(wrap180(180), -180);
  assert.equal(wrap180(350), -10);
});

test("poseToSectionPose keeps exactly the ten core bones and wraps angles", () => {
  const sp = poseToSectionPose(mkPose(1, 350));
  assert.deepEqual(Object.keys(sp.bones).sort(), [...SECTION_BONE_IDS].sort());
  assert.equal(sp.bones.torso[0], -10);          // 350 → −10
  assert.equal(sp.bones.torso[1], -45);
  assert.equal(sp.facing, -10);                  // 350 → −10
  assert.equal(sp.hipY, 0.95);
});

test("validateSection accepts a good section and rejects bad ones", () => {
  const good = {
    v: 1, id: "a", name: "s", createdAt: 1, tempo: 100, beats: 4,
    source: { file: "f.mp4", startSec: 0, endSec: 2.4 },
    keys: [{ beat: 0, pose: poseToSectionPose(mkPose(0)) }, { beat: 1.25, pose: poseToSectionPose(mkPose(1)) }],
  };
  assert.equal(validateSection(good).beats, 4);
  assert.throws(() => validateSection({ ...good, v: 2 }), /version/);
  assert.throws(() => validateSection({ ...good, beats: 9 }), /beats/);
  assert.throws(() => validateSection({ ...good, keys: [] }), /beat 0/);
  assert.throws(() => validateSection({ ...good, keys: [{ beat: 0.1, pose: good.keys[0].pose }] }), /quarter/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --import tsx --test test/sectionize.test.ts`
Expected: FAIL — cannot find `../lib/sectionize`.

- [ ] **Step 4: Implement**

`lib/sectionize.ts` (first half):

```ts
/* ------------------------------------------------------------------
   Sections: up to 8 beats of quantized keyframes in the shared
   movement-languages format. The vanilla twin of the schema lives in
   public/movement-languages/section-store.js — keep them in step.
   ------------------------------------------------------------------ */

import type { AzEl } from "./geometry";
import type { Pose } from "./pose";

export const SECTION_BONE_IDS = [
  "torso", "head", "ruarm", "rfarm", "luarm", "lfarm",
  "rthigh", "rshin", "lthigh", "lshin",
] as const;
export type SectionBoneId = (typeof SECTION_BONE_IDS)[number];

export interface SectionPose {
  x: number; z: number; facing: number; hipY: number;
  bones: Record<SectionBoneId, AzEl>;
}
export interface SectionKey { beat: number; pose: SectionPose }
export interface Section {
  v: 1; id: string; name: string; createdAt: number;
  tempo: number; beats: number;
  source: { file: string; startSec: number; endSec: number };
  keys: SectionKey[];
}
export interface Choreography {
  v: 1; id: string; name: string; tempo: number;
  items: { sectionId: string; repeat: number }[];
}

export const wrap180 = (a: number): number => ((a % 360) + 540) % 360 - 180;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function poseToSectionPose(p: Pose): SectionPose {
  const bones = {} as Record<SectionBoneId, AzEl>;
  for (const id of SECTION_BONE_IDS) {
    const [az, el] = p.bones[id];
    bones[id] = [r2(wrap180(az)), r2(el)];
  }
  return { x: r2(p.x), z: r2(p.z), facing: r2(wrap180(p.facing)), hipY: r2(p.hipY), bones };
}

const isQuarter = (b: number) => Number.isFinite(b) && Math.round(b * 4) === b * 4;

export function validateSection(o: unknown): Section {
  const s = o as Section;
  if (!s || typeof s !== "object") throw new Error("not an object");
  if (s.v !== 1) throw new Error("unsupported section version");
  if (typeof s.id !== "string" || !s.id) throw new Error("missing id");
  if (typeof s.name !== "string") throw new Error("missing name");
  if (!Number.isInteger(s.beats) || s.beats < 1 || s.beats > 8) throw new Error("beats must be an integer 1–8");
  if (typeof s.tempo !== "number" || s.tempo <= 0) throw new Error("bad tempo");
  if (!Array.isArray(s.keys) || !s.keys.length) throw new Error("a key at beat 0 is required");
  if (s.keys[0].beat !== 0) throw new Error("a key at beat 0 is required");
  for (const k of s.keys) {
    if (!isQuarter(k.beat) || k.beat < 0 || k.beat >= s.beats) throw new Error("key beats must be quarter multiples in [0, beats)");
    if (!k.pose || typeof k.pose !== "object" || !k.pose.bones) throw new Error("key missing pose");
    for (const id of SECTION_BONE_IDS) {
      const b = k.pose.bones[id];
      if (!Array.isArray(b) || b.length !== 2 || typeof b[0] !== "number" || typeof b[1] !== "number")
        throw new Error(`pose missing bone ${id}`);
    }
    for (const f of ["x", "z", "facing", "hipY"] as const)
      if (typeof k.pose[f] !== "number") throw new Error(`pose missing ${f}`);
  }
  return s;
}
```

Also create the placeholder `test/section-store.test.mjs`:

```js
import { test } from "node:test";
test("placeholder until Task 6", () => {});
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npm test` → PASS. `npx tsc --noEmit -p .` → no new errors. `npx eslint .` → clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/sectionize.ts test/helpers.ts test/sectionize.test.ts test/section-store.test.mjs
git commit -m "feat: section format — types, validation, pose conversion"
```

---

### Task 2: Quarter-beat quantization

**Files:**
- Modify: `lib/sectionize.ts` (append)
- Test: `test/sectionize.test.ts` (append)

**Interfaces:**
- Consumes: `Score`, `frameAt` from `lib/score.ts`; `fromAzEl` from `lib/geometry.ts`; Task 1 exports.
- Produces:
  - `interface QuantizeOptions { bpm: number; offsetSec: number; startBeat: number; lengthBeats: number }`
  - `quantizeKeys(score: Score, opts: QuantizeOptions): { keys: SectionKey[]; srcFrames: number[] }` — `srcFrames[i]` is the `score.frames` index behind `keys[i]` (used for stage preview)
  - `makeSection(score: Score, opts: QuantizeOptions, name: string): Section` — adds `id: crypto.randomUUID()`, `createdAt: Date.now()`, `tempo`, `beats`, `source`

- [ ] **Step 1: Write the failing tests** (append to `test/sectionize.test.ts`)

```ts
import { quantizeKeys, makeSection } from "../lib/sectionize";
import { DEFAULT_GRID } from "../lib/grid";
import { DEFAULT_SMOOTH, type Score } from "../lib/score";
import { BONES } from "../lib/skeleton";

function mkScore(keyframeTimes: number[], fps = 30, duration = 4): Score {
  const n = Math.round(duration * fps);
  const frames = Array.from({ length: n }, (_, i) => mkPose(i / fps, keyframeTimes.some((t) => Math.round(t * fps) === i) ? 90 : 0));
  const lengths = Object.fromEntries(BONES.map((b) => [b.id, b.len])) as Score["body"]["lengths"];
  return {
    version: 1,
    source: { name: "clip.mp4", duration, fps, width: 640, height: 480 },
    grid: DEFAULT_GRID, smooth: DEFAULT_SMOOTH, lift: "anchored",
    body: { lengths, hipWidth: 0.22, shoulderWidth: 0.36 },
    raw: frames, frames,
    keyframes: keyframeTimes.map((t) => Math.round(t * fps)),
  };
}

test("quantizeKeys snaps keyframes to the nearest quarter-beat", () => {
  // 120 bpm → beat = 0.5 s; quarter-beat = 0.125 s.
  const score = mkScore([0.0, 0.56, 1.10]);
  const { keys } = quantizeKeys(score, { bpm: 120, offsetSec: 0, startBeat: 0, lengthBeats: 4 });
  assert.deepEqual(keys.map((k) => k.beat), [0, 1, 2.25]);   // 0.56s→1.12 beats→1.0; 1.10s→2.2→2.25
});

test("quantizeKeys synthesizes a beat-0 key from the window start", () => {
  const score = mkScore([1.0]);
  const { keys, srcFrames } = quantizeKeys(score, { bpm: 60, offsetSec: 0, startBeat: 0, lengthBeats: 4 });
  assert.equal(keys[0].beat, 0);
  assert.equal(srcFrames[0], 0);
  assert.equal(keys.length, 2);
});

test("quantizeKeys drops keys outside the window and keeps beats < lengthBeats", () => {
  const score = mkScore([0.0, 0.5, 3.9]);   // at 60 bpm window of 2 beats: 3.9 s is outside
  const { keys } = quantizeKeys(score, { bpm: 60, offsetSec: 0, startBeat: 0, lengthBeats: 2 });
  assert.ok(keys.every((k) => k.beat >= 0 && k.beat < 2));
});

test("collision on one quarter-beat keeps the larger pose change", () => {
  // Two keyframes 0.05 s apart both snap to beat 1 at 60 bpm.
  const score = mkScore([1.0, 1.05]);
  const { keys, srcFrames } = quantizeKeys(score, { bpm: 60, offsetSec: 0, startBeat: 0, lengthBeats: 4 });
  const atBeat1 = keys.filter((k) => k.beat === 1);
  assert.equal(atBeat1.length, 1);
  assert.equal(srcFrames.filter((_, i) => keys[i].beat === 1).length, 1);
});

test("makeSection fills meta and validates", () => {
  const score = mkScore([0.0, 0.5]);
  const s = makeSection(score, { bpm: 120, offsetSec: 0.1, startBeat: 0, lengthBeats: 4 }, "test cut");
  assert.equal(s.beats, 4);
  assert.equal(s.tempo, 120);
  assert.equal(s.source.file, "clip.mp4");
  assert.ok(Math.abs(s.source.startSec - 0.1) < 1e-9);
  assert.ok(Math.abs(s.source.endSec - (0.1 + 4 * 0.5)) < 1e-9);
  validateSection(s);   // throws if malformed
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/sectionize.test.ts` → FAIL (`quantizeKeys` not exported).

- [ ] **Step 3: Implement** (append to `lib/sectionize.ts`)

```ts
import { fromAzEl } from "./geometry";
import { type Score, frameAt } from "./score";

export interface QuantizeOptions {
  bpm: number; offsetSec: number; startBeat: number; lengthBeats: number;
}

/** Total angular movement (deg) of the ten section bones between two frames. */
function changeMagnitude(score: Score, fi: number): number {
  if (fi <= 0) return Infinity;
  const a = score.frames[fi - 1], b = score.frames[fi];
  let sum = 0;
  for (const id of SECTION_BONE_IDS) {
    const va = fromAzEl(a.bones[id]), vb = fromAzEl(b.bones[id]);
    const d = Math.max(-1, Math.min(1, va.x * vb.x + va.y * vb.y + va.z * vb.z));
    sum += (Math.acos(d) * 180) / Math.PI;
  }
  return sum;
}

const snapQuarter = (b: number) => Math.round(b * 4) / 4;

export function quantizeKeys(score: Score, opts: QuantizeOptions): { keys: SectionKey[]; srcFrames: number[] } {
  const { bpm, offsetSec, startBeat, lengthBeats } = opts;
  const toBeat = (t: number) => ((t - offsetSec) * bpm) / 60 - startBeat;
  // beat (quarter-multiple) → winning frame index
  const byBeat = new Map<number, number>();
  for (const fi of score.keyframes) {
    const b = snapQuarter(toBeat(score.frames[fi].t));
    if (b < 0 || b >= lengthBeats) continue;
    const cur = byBeat.get(b);
    if (cur === undefined || changeMagnitude(score, fi) > changeMagnitude(score, cur)) byBeat.set(b, fi);
  }
  if (!byBeat.has(0)) byBeat.set(0, frameAt(score, offsetSec + (startBeat * 60) / bpm));
  const beats = [...byBeat.keys()].sort((a, b) => a - b);
  return {
    keys: beats.map((b) => ({ beat: b, pose: poseToSectionPose(score.frames[byBeat.get(b)!]) })),
    srcFrames: beats.map((b) => byBeat.get(b)!),
  };
}

export function makeSection(score: Score, opts: QuantizeOptions, name: string): Section {
  const { keys } = quantizeKeys(score, opts);
  const startSec = opts.offsetSec + (opts.startBeat * 60) / opts.bpm;
  return validateSection({
    v: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    tempo: Math.round(opts.bpm * 100) / 100,
    beats: opts.lengthBeats,
    source: { file: score.source.name, startSec, endSec: startSec + (opts.lengthBeats * 60) / opts.bpm },
    keys,
  });
}
```

Note: `import` statements go at the top of the file with the existing ones (ESLint will flag them otherwise).

- [ ] **Step 4: Run tests, typecheck, lint** — all green.

- [ ] **Step 5: Commit**

```bash
git add lib/sectionize.ts test/sectionize.test.ts
git commit -m "feat: quarter-beat quantization of score keyframes into sections"
```

---

### Task 3: Tempo estimation

**Files:**
- Create: `lib/tempo.ts`
- Test: `test/tempo.test.ts`

**Interfaces:**
- Consumes: `Pose` from `lib/pose.ts`; `fromAzEl` from `lib/geometry.ts`; `SECTION_BONE_IDS` from `lib/sectionize.ts`.
- Produces:
  - `interface TempoEstimate { bpm: number; offsetSec: number; confidence: number }` (confidence 0..1; 0 = fallback)
  - `estimateTempo(raw: Pose[], keyframeTimes: number[], fps: number): TempoEstimate`
  - `movementSignal(raw: Pose[], fps: number): number[]` (exported for tests)

- [ ] **Step 1: Write the failing tests**

`test/tempo.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTempo, movementSignal } from "../lib/tempo";
import type { Pose } from "../lib/pose";
import { BONE_IDS } from "../lib/skeleton";
import type { AzEl } from "../lib/geometry";

/** Synthetic dance: arms swing sinusoidally with the given beat period. */
function synthRaw(periodSec: number, fps = 30, durationSec = 8): Pose[] {
  const n = Math.round(durationSec * fps);
  return Array.from({ length: n }, (_, i) => {
    const t = i / fps;
    const az = 45 * Math.sin((2 * Math.PI * t) / periodSec);
    const bones = Object.fromEntries(BONE_IDS.map((id) => [id, [id === "ruarm" || id === "luarm" ? az : 0, -30] as AzEl])) as Pose["bones"];
    return { t, facing: 0, x: 0, z: 0, hipY: 0.95, bones, conf: 0.9 };
  });
}

test("movementSignal is periodic with the swing", () => {
  const s = movementSignal(synthRaw(0.5), 30);
  assert.equal(s.length, 240);
  assert.ok(Math.max(...s) > 0);
});

test("estimateTempo finds ~120 bpm for a 0.5 s period", () => {
  const raw = synthRaw(0.5);
  const kf = Array.from({ length: 16 }, (_, i) => i * 0.5);   // keyframes on the beat
  const est = estimateTempo(raw, kf, 30);
  // Half/double ambiguity is allowed; accept 60, 120, or 240 within 3 bpm.
  const ok = [60, 120, 240].some((b) => Math.abs(est.bpm - b) <= 3);
  assert.ok(ok, `got ${est.bpm}`);
  assert.ok(est.confidence > 0.2);
});

test("estimateTempo offset aligns keyframes to the grid", () => {
  const raw = synthRaw(0.5);
  const kf = Array.from({ length: 14 }, (_, i) => 0.2 + i * 0.5);  // beats shifted by 0.2 s
  const est = estimateTempo(raw, kf, 30);
  const period = 60 / est.bpm;
  // Offset should place keyframes near beat lines: residual of 0.2 modulo period.
  const res = Math.abs(((0.2 - est.offsetSec) % period + period) % period);
  assert.ok(res < period * 0.15 || res > period * 0.85, `residual ${res} of period ${period}`);
});

test("estimateTempo falls back on short or still input", () => {
  const est = estimateTempo(synthRaw(0.5, 30, 1.5), [], 30);
  assert.equal(est.bpm, 100);
  assert.equal(est.confidence, 0);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

`lib/tempo.ts`:

```ts
/* ------------------------------------------------------------------
   Motion-derived tempo: autocorrelate a movement-intensity signal
   over plausible beat periods, then phase-align to the keyframes.
   An estimate, never an authority — the UI always allows override.
   ------------------------------------------------------------------ */

import { fromAzEl } from "./geometry";
import type { Pose } from "./pose";
import { SECTION_BONE_IDS } from "./sectionize";

export interface TempoEstimate { bpm: number; offsetSec: number; confidence: number }

export const FALLBACK: TempoEstimate = { bpm: 100, offsetSec: 0, confidence: 0 };
const BPM_MIN = 30, BPM_MAX = 200, BPM_STEP = 0.5;

/** Mean angular speed (deg/s) of the ten section bones, per frame. */
export function movementSignal(raw: Pose[], fps: number): number[] {
  const out = new Array<number>(raw.length).fill(0);
  for (let i = 1; i < raw.length; i++) {
    let sum = 0;
    for (const id of SECTION_BONE_IDS) {
      const a = fromAzEl(raw[i - 1].bones[id]), b = fromAzEl(raw[i].bones[id]);
      const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
      sum += (Math.acos(d) * 180) / Math.PI;
    }
    out[i] = (sum / SECTION_BONE_IDS.length) * fps;
  }
  return out;
}

/** Normalized autocorrelation at a (fractional) lag, linear-interpolated. */
function autocorr(s: number[], lag: number): number {
  const n = s.length;
  const i0 = Math.floor(lag), frac = lag - i0;
  let num = 0, den = 0;
  for (let i = 0; i + i0 + 1 < n; i++) {
    const lagged = s[i + i0] * (1 - frac) + s[i + i0 + 1] * frac;
    num += s[i] * lagged;
    den += s[i] * s[i];
  }
  return den > 1e-9 ? num / den : 0;
}

export function estimateTempo(raw: Pose[], keyframeTimes: number[], fps: number): TempoEstimate {
  if (raw.length < 3 * fps) return FALLBACK;
  const s0 = movementSignal(raw, fps);
  const mean = s0.reduce((a, b) => a + b, 0) / s0.length;
  const s = s0.map((v) => v - mean);
  if (Math.max(...s0) < 5) return FALLBACK;   // essentially still

  let bestBpm = 0, bestR = -Infinity;
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += BPM_STEP) {
    const lag = (fps * 60) / bpm;
    if (lag >= raw.length / 2) continue;
    const r = autocorr(s, lag) + 0.4 * autocorr(s, 2 * lag);
    if (r > bestR) { bestR = r; bestBpm = bpm; }
  }
  if (bestBpm === 0 || bestR < 0.1) return FALLBACK;

  // Phase: circular mean of keyframe times against the beat period.
  const period = 60 / bestBpm;
  let offsetSec = 0, align = 0;
  if (keyframeTimes.length >= 2) {
    let sx = 0, sy = 0;
    for (const t of keyframeTimes) { const a = (2 * Math.PI * t) / period; sx += Math.cos(a); sy += Math.sin(a); }
    offsetSec = ((Math.atan2(sy, sx) / (2 * Math.PI)) * period + period) % period;
    align = Math.hypot(sx, sy) / keyframeTimes.length;   // 0..1
  }
  const confidence = Math.max(0, Math.min(1, bestR)) * (0.5 + 0.5 * align);
  return { bpm: bestBpm, offsetSec: Math.round(offsetSec * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 };
}
```

- [ ] **Step 4: Run tests, typecheck, lint** — all green. If the 120-bpm test lands on a harmonic outside tolerance, adjust the `0.4` sub-harmonic weight, not the test.

- [ ] **Step 5: Commit**

```bash
git add lib/tempo.ts test/tempo.test.ts
git commit -m "feat: motion-derived tempo estimation with keyframe phase alignment"
```

---

### Task 4: IndexedDB helper (TS side)

**Files:**
- Create: `lib/sectionsDb.ts`
- Test: `test/sectionsDb.test.ts`

**Interfaces:**
- Consumes: `Section`, `Choreography`, `validateSection` from `lib/sectionize.ts`.
- Produces:
  - `DB_NAME = "movement-languages"`, `DB_VERSION = 1`, `STORE_SECTIONS = "sections"`, `STORE_CHOREOGRAPHIES = "choreographies"`
  - `putSection(s: Section): Promise<void>`
  - `listSections(): Promise<Section[]>` — newest first (by `createdAt`)
  - `deleteSection(id: string): Promise<void>`
  - `putChoreography(c: Choreography): Promise<void>`
  - `listChoreographies(): Promise<Choreography[]>`
  - All reject with the underlying error if IndexedDB is unavailable; callers surface the message.

- [ ] **Step 1: Write the failing test**

`test/sectionsDb.test.ts`:

```ts
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { putSection, listSections, deleteSection, putChoreography, listChoreographies } from "../lib/sectionsDb";
import { poseToSectionPose, type Section } from "../lib/sectionize";
import { mkPose } from "./helpers";

function mkSection(id: string, createdAt: number): Section {
  return {
    v: 1, id, name: "s-" + id, createdAt, tempo: 100, beats: 4,
    source: { file: "f", startSec: 0, endSec: 2.4 },
    keys: [{ beat: 0, pose: poseToSectionPose(mkPose(0)) }],
  };
}

test("put/list/delete sections round-trips, newest first", async () => {
  await putSection(mkSection("a", 1));
  await putSection(mkSection("b", 2));
  let all = await listSections();
  assert.deepEqual(all.map((s) => s.id), ["b", "a"]);
  await deleteSection("a");
  all = await listSections();
  assert.deepEqual(all.map((s) => s.id), ["b"]);
});

test("choreographies store round-trips", async () => {
  await putChoreography({ v: 1, id: "c1", name: "Study", tempo: 100, items: [{ sectionId: "b", repeat: 2 }] });
  const all = await listChoreographies();
  assert.equal(all[0].items[0].repeat, 2);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

`lib/sectionsDb.ts`:

```ts
/* ------------------------------------------------------------------
   The shared movement-languages IndexedDB. The vanilla twin used by
   the static pages is public/movement-languages/section-store.js —
   same DB name, stores, and format; keep them in step.
   ------------------------------------------------------------------ */

import { type Choreography, type Section, validateSection } from "./sectionize";

export const DB_NAME = "movement-languages";
export const DB_VERSION = 1;
export const STORE_SECTIONS = "sections";
export const STORE_CHOREOGRAPHIES = "choreographies";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SECTIONS)) db.createObjectStore(STORE_SECTIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_CHOREOGRAPHIES)) db.createObjectStore(STORE_CHOREOGRAPHIES, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => { db.close(); resolve(req.result); };
        t.onerror = () => { db.close(); reject(t.error); };
      }),
  );
}

export function putSection(s: Section): Promise<void> {
  validateSection(s);
  return tx(STORE_SECTIONS, "readwrite", (st) => st.put(s)).then(() => undefined);
}
export function listSections(): Promise<Section[]> {
  return tx<Section[]>(STORE_SECTIONS, "readonly", (st) => st.getAll() as IDBRequest<Section[]>)
    .then((all) => all.sort((a, b) => b.createdAt - a.createdAt));
}
export function deleteSection(id: string): Promise<void> {
  return tx(STORE_SECTIONS, "readwrite", (st) => st.delete(id)).then(() => undefined);
}
export function putChoreography(c: Choreography): Promise<void> {
  return tx(STORE_CHOREOGRAPHIES, "readwrite", (st) => st.put(c)).then(() => undefined);
}
export function listChoreographies(): Promise<Choreography[]> {
  return tx<Choreography[]>(STORE_CHOREOGRAPHIES, "readonly", (st) => st.getAll() as IDBRequest<Choreography[]>);
}
```

- [ ] **Step 4: Run tests, typecheck, lint** — all green.

- [ ] **Step 5: Commit**

```bash
git add lib/sectionsDb.ts test/sectionsDb.test.ts
git commit -m "feat: IndexedDB helper for the shared section/choreography library"
```

---

### Task 5: Section panel in the vid2grid UI

**Files:**
- Create: `components/SectionPanel.tsx`
- Modify: `components/App.tsx`

**Interfaces:**
- Consumes: `estimateTempo`/`TempoEstimate` (Task 3), `quantizeKeys`/`makeSection`/`QuantizeOptions` (Task 2), `putSection` (Task 4).
- Produces: `SectionPanel` React component with props
  `{ score: Score; cfg: SectionCfg; onCfg: (c: SectionCfg) => void; estimate: TempoEstimate | null; onSeek: (t: number) => void }`
  where `export interface SectionCfg extends QuantizeOptions { preview: boolean }` (exported from `SectionPanel.tsx`).
- App state addition: `sectionCfg: SectionCfg`, derived `quantized = quantizeKeys(score, sectionCfg)`, and preview pose substitution for the Stage.

- [ ] **Step 1: Implement `components/SectionPanel.tsx`**

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import type { Score } from "@/lib/score";
import { type QuantizeOptions, makeSection, quantizeKeys } from "@/lib/sectionize";
import { putSection } from "@/lib/sectionsDb";
import type { TempoEstimate } from "@/lib/tempo";

export interface SectionCfg extends QuantizeOptions { preview: boolean }

interface Props {
  score: Score;
  cfg: SectionCfg;
  onCfg: (c: SectionCfg) => void;
  estimate: TempoEstimate | null;
  onSeek: (t: number) => void;
}

export default function SectionPanel({ score, cfg, onCfg, estimate, onSeek }: Props) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const taps = useRef<number[]>([]);

  const quantized = useMemo(() => quantizeKeys(score, cfg), [score, cfg]);
  const duration = score.source.duration;
  const beatSec = 60 / cfg.bpm;
  const maxStart = Math.max(0, Math.floor((duration - cfg.offsetSec) / beatSec) - cfg.lengthBeats);

  const set = (patch: Partial<SectionCfg>) => onCfg({ ...cfg, ...patch });

  const tap = () => {
    const now = performance.now() / 1000;
    taps.current = [...taps.current.filter((t) => now - t < 3), now];
    if (taps.current.length >= 2) {
      const iv = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const bpm = Math.round((60 / (iv.reduce((a, b) => a + b, 0) / iv.length)) * 10) / 10;
      if (bpm >= 30 && bpm <= 200) set({ bpm });
    }
  };

  const save = async () => {
    try {
      const s = makeSection(score, cfg, name.trim() || `section ${new Date().toLocaleTimeString()}`);
      await putSection(s);
      setStatus(`saved “${s.name}” — ${s.keys.length} keys / ${s.beats} beats`);
    } catch (e) {
      setStatus(`could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const download = () => {
    const s = makeSection(score, cfg, name.trim() || "section");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: "application/json" }));
    a.download = `${s.name.replace(/\s+/g, "-")}.section.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* --- beat strip: beats, keyframe ticks, quantized keys, draggable window --- */
  const stripW = 260, stripH = 46;
  const px = (t: number) => (t / duration) * stripW;
  const winStartSec = cfg.offsetSec + cfg.startBeat * beatSec;
  const winEndSec = winStartSec + cfg.lengthBeats * beatSec;
  const drag = useRef<{ mode: "move" | "resize"; x0: number; start0: number; len0: number } | null>(null);

  const onStripPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * stripW;
    if (e.type === "pointerdown") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const nearEnd = Math.abs(x - px(winEndSec)) < 7;
      drag.current = { mode: nearEnd ? "resize" : "move", x0: x, start0: cfg.startBeat, len0: cfg.lengthBeats };
    } else if (e.type === "pointermove" && drag.current) {
      const dBeats = ((x - drag.current.x0) / stripW) * (duration / beatSec);
      if (drag.current.mode === "move") {
        set({ startBeat: Math.max(0, Math.min(maxStart + cfg.lengthBeats - 1, Math.round(drag.current.start0 + dBeats))) });
      } else {
        set({ lengthBeats: Math.max(1, Math.min(8, Math.round(drag.current.len0 + dBeats))) });
      }
    } else if (e.type === "pointerup") {
      drag.current = null;
      onSeek(winStartSec);
    }
  };

  const beats: number[] = [];
  for (let b = 0; cfg.offsetSec + b * beatSec <= duration; b++) beats.push(b);

  return (
    <div className="px-3 pb-3 text-xs flex flex-col gap-2 border-t border-line pt-2">
      <div className="text-muted">section — quantized to ¼ beats</div>
      {estimate && (
        <div className="text-[11px] text-muted">
          estimate: {estimate.bpm} bpm{estimate.confidence === 0 ? " (fallback — clip too short or still)" : ` · confidence ${Math.round(estimate.confidence * 100)}%`}
        </div>
      )}
      <label className="grid grid-cols-[7.5rem_1fr_3.2rem] items-center gap-2">
        <span className="text-muted mono">tempo</span>
        <input type="range" min={30} max={200} step={0.5} value={cfg.bpm} onChange={(e) => set({ bpm: +e.target.value })} />
        <input className="bg-panel-2 rounded px-1 py-0.5 mono" type="number" min={30} max={200} step={0.5} value={cfg.bpm} onChange={(e) => set({ bpm: +e.target.value })} aria-label="BPM" />
      </label>
      <div className="flex items-center gap-2">
        <button className="btn" onClick={tap}>tap tempo</button>
        <span className="text-muted mono">offset {cfg.offsetSec.toFixed(2)} s</span>
        <button className="btn" onClick={() => set({ offsetSec: Math.max(0, cfg.offsetSec - beatSec / 8) })}>−⅛</button>
        <button className="btn" onClick={() => set({ offsetSec: cfg.offsetSec + beatSec / 8 })}>+⅛</button>
      </div>
      <svg
        viewBox={`0 0 ${stripW} ${stripH}`} className="w-full h-14 rounded bg-panel-2 cursor-ew-resize touch-none"
        onPointerDown={onStripPointer} onPointerMove={onStripPointer} onPointerUp={onStripPointer}
      >
        {beats.map((b) => (
          <line key={b} x1={px(cfg.offsetSec + b * beatSec)} x2={px(cfg.offsetSec + b * beatSec)} y1={4} y2={stripH - 4}
            stroke="currentColor" strokeOpacity={b % 4 === 0 ? 0.7 : 0.25} strokeWidth={b % 4 === 0 ? 1.2 : 0.7} />
        ))}
        {score.keyframes.map((fi) => (
          <line key={fi} x1={px(score.frames[fi].t)} x2={px(score.frames[fi].t)} y1={stripH - 14} y2={stripH - 4} stroke="#f0b429" strokeWidth={1} />
        ))}
        <rect x={px(winStartSec)} y={2} width={Math.max(2, px(winEndSec) - px(winStartSec))} height={stripH - 4}
          fill="#f0b429" fillOpacity={0.15} stroke="#f0b429" strokeWidth={1} />
        {quantized.keys.map((k, i) => {
          const x = px(winStartSec + k.beat * beatSec);
          return <path key={i} d={`M${x},${10} l4,6 l-4,6 l-4,-6 Z`} fill="#f0b429" />;
        })}
      </svg>
      <div className="flex items-center gap-2">
        <span className="text-muted mono">start beat {cfg.startBeat} · length {cfg.lengthBeats} · {quantized.keys.length} keys</span>
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={cfg.preview} onChange={(e) => set({ preview: e.target.checked })} /> preview quantized
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input className="bg-panel-2 rounded px-2 py-1 flex-1" placeholder="section name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Section name" />
        <button className="btn" onClick={save}>save to library</button>
        <button className="btn" onClick={download}>JSON</button>
      </div>
      {status && <div className="text-[11px] text-muted">{status}</div>}
      <div className="text-[11px] text-muted">
        sections open in the <a className="underline" href="/movement-languages/danceforms.html">studio</a> library
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `components/App.tsx`**

Add imports:

```tsx
import SectionPanel, { type SectionCfg } from "./SectionPanel";
import { estimateTempo } from "@/lib/tempo";
import { quantizeKeys } from "@/lib/sectionize";
```

Add state + derivations after the `score` memo (after current line 86):

```tsx
const [sectionCfg, setSectionCfg] = useState<SectionCfg>({ bpm: 100, offsetSec: 0, startBeat: 0, lengthBeats: 8, preview: false });
const cfgTouched = useRef(false);
const onSectionCfg = useCallback((c: SectionCfg) => { cfgTouched.current = true; setSectionCfg(c); }, []);
const estimate = useMemo(
  () => (score ? estimateTempo(score.raw, score.keyframes.map((i) => score.raw[i].t), score.source.fps) : null),
  [score],
);
useEffect(() => {
  if (!estimate || cfgTouched.current) return;
  setSectionCfg((c) => ({
    ...c,
    bpm: estimate.bpm,
    offsetSec: estimate.offsetSec,
    lengthBeats: score ? Math.max(1, Math.min(8, Math.floor(((score.source.duration - estimate.offsetSec) * estimate.bpm) / 60))) : 8,
  }));
}, [estimate, score]);
useEffect(() => { cfgTouched.current = false; }, [analysis, imported]);

const quantized = useMemo(() => (score ? quantizeKeys(score, sectionCfg) : null), [score, sectionCfg]);
const previewPose = useMemo(() => {
  if (!score || !quantized || !sectionCfg.preview) return null;
  const beat = ((time - sectionCfg.offsetSec) * sectionCfg.bpm) / 60 - sectionCfg.startBeat;
  if (beat < 0 || beat >= sectionCfg.lengthBeats) return null;
  let i = 0;
  while (i < quantized.keys.length - 1 && quantized.keys[i + 1].beat <= beat) i++;
  return score.frames[quantized.srcFrames[i]];
}, [score, quantized, sectionCfg, time]);
```

In the Stage call (current line 284) replace `pose={snappedPose}` with `pose={previewPose ?? snappedPose}`.

In the right column score-view fragment, after the existing `{score && (...)}` info block (current lines 317–323), add:

```tsx
{score && <SectionPanel score={score} cfg={sectionCfg} onCfg={onSectionCfg} estimate={estimate} onSeek={seek} />}
```

In the header (after the export JSON button, current line 241) add nav links:

```tsx
<a className="btn" href="/movement-languages/danceforms.html">studio</a>
<a className="btn" href="/movement-languages/index.html">parameters</a>
```

- [ ] **Step 3: Typecheck + lint + tests**

Run: `npx tsc --noEmit -p .` · `npx eslint .` · `npm test` — all green.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev` (or use the already-running server; logs at `.next/dev/logs/next-development.log`). Import any prior `.vid2grid.json` score (or track a clip). Verify: estimate line appears; BPM slider re-quantizes the diamonds live; window drags and resizes on the strip; preview checkbox switches the stage to held quantized poses; save reports success. (The studio link 404s until Task 6 — expected.)

- [ ] **Step 5: Commit**

```bash
git add components/SectionPanel.tsx components/App.tsx
git commit -m "feat: Section panel — tempo controls, beat strip, quantize preview, save"
```

---

### Task 6: Copy static pages, shared store script, nav integration

**Files:**
- Create: `public/movement-languages/section-store.js`
- Create: `public/movement-languages/danceforms.html` (copy + nav edits + script include)
- Create: `public/movement-languages/index.html` (copy + nav edits + script include)
- Test: `test/section-store.test.mjs` (replace placeholder)

**Interfaces:**
- Produces `window.SectionStore` (and CommonJS export for tests) with:
  - `validateSection(o)` — same rules as TS twin, returns the section or throws
  - `buildChoreographyKeys(items, sectionsById)` → `{ keys: [{beat, pose}], totalBeats, missing: [sectionId] }` — pure, poses deep-cloned
  - `listSections() / getSection(id) / putSection(s) / deleteSection(id)` — Promises
  - `listChoreographies() / getChoreography(id) / putChoreography(c) / deleteChoreography(id)` — Promises
  - `exportAll()` → Promise of `{ v: 1, sections: [...], choreographies: [...] }`
  - `importData(obj)` → Promise; validates and puts every section/choreography in the object
  - `available()` → boolean (feature-detects `indexedDB`)

- [ ] **Step 1: Write the failing test** (replace `test/section-store.test.mjs`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const SectionStore = createRequire(import.meta.url)("../public/movement-languages/section-store.js");

const pose = () => ({
  x: 0, z: 0, facing: 0, hipY: 0.95,
  bones: Object.fromEntries(
    ["torso","head","ruarm","rfarm","luarm","lfarm","rthigh","rshin","lthigh","lshin"].map((id) => [id, [0, -45]]),
  ),
});
const section = (id, beats, nKeys) => ({
  v: 1, id, name: "s" + id, createdAt: 1, tempo: 100, beats,
  source: { file: "f", startSec: 0, endSec: 1 },
  keys: Array.from({ length: nKeys }, (_, i) => ({ beat: i * 0.25, pose: pose() })),
});

test("validateSection matches the TS twin's rules", () => {
  SectionStore.validateSection(section("a", 4, 3));
  assert.throws(() => SectionStore.validateSection({ ...section("a", 4, 3), v: 2 }));
  assert.throws(() => SectionStore.validateSection(section("a", 9, 3)));
});

test("buildChoreographyKeys concatenates with repeats and reports missing", () => {
  const a = section("a", 2, 2), b = section("b", 4, 3);
  const { keys, totalBeats, missing } = SectionStore.buildChoreographyKeys(
    [{ sectionId: "a", repeat: 2 }, { sectionId: "gone", repeat: 1 }, { sectionId: "b", repeat: 1 }],
    { a, b },
  );
  assert.equal(totalBeats, 2 + 2 + 4);
  assert.deepEqual(missing, ["gone"]);
  assert.deepEqual(keys.map((k) => k.beat), [0, 0.25, 2, 2.25, 4, 4.25, 4.5]);
  keys[0].pose.bones.torso[0] = 99;               // clones, not references
  assert.equal(a.keys[0].pose.bones.torso[0], 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/section-store.test.mjs` → FAIL (file missing).

- [ ] **Step 3: Implement `public/movement-languages/section-store.js`**

```js
/* movement-languages shared store — the vanilla twin of lib/sectionize.ts +
   lib/sectionsDb.ts. One DB per origin: "movement-languages" v1, stores
   "sections" and "choreographies" (keyPath "id"). Keep in step with the TS side. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.SectionStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const DB_NAME = "movement-languages", DB_VERSION = 1;
  const S = "sections", C = "choreographies";
  const BONE_IDS = ["torso","head","ruarm","rfarm","luarm","lfarm","rthigh","rshin","lthigh","lshin"];

  function validateSection(s) {
    if (!s || typeof s !== "object") throw new Error("not an object");
    if (s.v !== 1) throw new Error("unsupported section version");
    if (typeof s.id !== "string" || !s.id) throw new Error("missing id");
    if (!Number.isInteger(s.beats) || s.beats < 1 || s.beats > 8) throw new Error("beats must be an integer 1–8");
    if (typeof s.tempo !== "number" || s.tempo <= 0) throw new Error("bad tempo");
    if (!Array.isArray(s.keys) || !s.keys.length || s.keys[0].beat !== 0) throw new Error("a key at beat 0 is required");
    for (const k of s.keys) {
      if (!(Math.round(k.beat * 4) === k.beat * 4) || k.beat < 0 || k.beat >= s.beats)
        throw new Error("key beats must be quarter multiples in [0, beats)");
      if (!k.pose || !k.pose.bones) throw new Error("key missing pose");
      for (const id of BONE_IDS) {
        const b = k.pose.bones[id];
        if (!Array.isArray(b) || b.length !== 2) throw new Error("pose missing bone " + id);
      }
      for (const f of ["x", "z", "facing", "hipY"]) if (typeof k.pose[f] !== "number") throw new Error("pose missing " + f);
    }
    return s;
  }

  function buildChoreographyKeys(items, sectionsById) {
    const keys = [], missing = [];
    let cursor = 0;
    for (const it of items || []) {
      const sec = sectionsById[it.sectionId];
      if (!sec) { missing.push(it.sectionId); continue; }
      const rep = Math.max(1, Math.round(it.repeat || 1));
      for (let r = 0; r < rep; r++) {
        for (const k of sec.keys) keys.push({ beat: cursor + k.beat, pose: JSON.parse(JSON.stringify(k.pose)) });
        cursor += sec.beats;
      }
    }
    return { keys, totalBeats: cursor, missing };
  }

  function available() { return typeof indexedDB !== "undefined"; }
  function open() {
    return new Promise(function (resolve, reject) {
      if (!available()) return reject(new Error("IndexedDB unavailable in this browser/mode"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(S)) db.createObjectStore(S, { keyPath: "id" });
        if (!db.objectStoreNames.contains(C)) db.createObjectStore(C, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB open failed")); };
    });
  }
  function tx(store, mode, run) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = function () { db.close(); resolve(req && req.result); };
        t.onerror = function () { db.close(); reject(t.error); };
      });
    });
  }

  return {
    DB_NAME, validateSection, buildChoreographyKeys, available,
    putSection: (s) => { validateSection(s); return tx(S, "readwrite", (st) => st.put(s)); },
    getSection: (id) => tx(S, "readonly", (st) => st.get(id)),
    listSections: () => tx(S, "readonly", (st) => st.getAll()).then((a) => (a || []).sort((x, y) => y.createdAt - x.createdAt)),
    deleteSection: (id) => tx(S, "readwrite", (st) => st.delete(id)),
    putChoreography: (c) => tx(C, "readwrite", (st) => st.put(c)),
    getChoreography: (id) => tx(C, "readonly", (st) => st.get(id)),
    listChoreographies: () => tx(C, "readonly", (st) => st.getAll()).then((a) => a || []),
    deleteChoreography: (id) => tx(C, "readwrite", (st) => st.delete(id)),
    exportAll: function () {
      return Promise.all([this.listSections(), this.listChoreographies()]).then(function (r) {
        return { v: 1, sections: r[0], choreographies: r[1] };
      });
    },
    importData: function (obj) {
      const self = this;
      const secs = (obj && obj.sections) || (obj && obj.v === 1 && obj.keys ? [obj] : []);
      const chors = (obj && obj.choreographies) || [];
      return Promise.all(
        secs.map((s) => self.putSection(s)).concat(chors.map((c) => self.putChoreography(c))),
      ).then(() => ({ sections: secs.length, choreographies: chors.length }));
    },
  };
});
```

(`importData` accepts both an export bundle and a single bare `.section.json` file.)

- [ ] **Step 4: Copy the pages and fix navigation**

```bash
mkdir -p public/movement-languages
cp ../danceforms.html public/movement-languages/danceforms.html
cp ../index.html public/movement-languages/index.html
```

In **`public/movement-languages/danceforms.html`**:
- Delete the artifact-URL override block (the 5 lines starting `const PARAMS_URL = "https://claude.ai/code/artifact/...` through its closing `}`; the comment line above it too).
- In the `<nav class="pages disp">` add as first link: `<a href="/">Capture</a>` (the vid2grid app).
- Immediately before the existing `<script>` tag add: `<script src="section-store.js"></script>`.

In **`public/movement-languages/index.html`**:
- Delete the artifact override (the 3 lines `if(location.protocol!=="file:"){ document.getElementById("navStudio").href = ...; }` plus its comment).
- In `<nav class="pages disp">` add as first link: `<a href="/">Capture</a>`.
- Immediately before the main `<script>` tag add: `<script src="section-store.js"></script>`.

- [ ] **Step 5: Run tests + serve check**

Run: `npm test` → all green (including the new `.mjs` test).
With the dev server running, open `http://localhost:3000/movement-languages/danceforms.html` and `.../index.html`: pages render, nav links round-trip between `/`, Parameters, and Studio; console shows no errors; `window.SectionStore.available()` is `true`.

- [ ] **Step 6: Commit**

```bash
git add public/movement-languages test/section-store.test.mjs
git commit -m "feat: shared section store + static pages integrated under /movement-languages/"
```

---

### Task 7: danceforms Library drawer

**Files:**
- Modify: `public/movement-languages/danceforms.html`

**Interfaces:**
- Consumes: `window.SectionStore` (Task 6). Existing page internals: `score`, `state`, `renderAll()`, `clonePose()`, `save()`.
- Produces (page-internal, used by Task 8): `refreshLibrary()`, `sectionToTrackKeys(section)` → `[{beat, pose}]` (clone of the section's keys at beat offsets from 0), `libStatus(msg)`.

- [ ] **Step 1: Add the Library panel markup**

After the timeline `panel` div (it ends with the `</div>` following the `Chance operations` toolrow, just before the `<p class="caption">Every keyframe stores…`), insert:

```html
    <!-- library -->
    <div class="panel" style="margin-top:16px">
      <div class="panel-cap"><span class="dotk"></span><span>Library — sections captured in vid2grid</span><span class="capsp"></span>
        <span class="mono" id="libStatus" style="font-size:11px"></span>
        <button class="btn sm disp" id="btnLibRefresh">Refresh</button>
        <button class="btn sm disp" id="btnLibExport">Export JSON</button>
        <label class="btn sm disp" style="cursor:pointer">Import JSON<input type="file" id="libImport" accept=".json,application/json" style="display:none"></label>
      </div>
      <div class="pad" id="libraryList"><p class="caption">No sections yet — capture one in <a href="/">vid2grid</a>, or import JSON.</p></div>
    </div>
```

- [ ] **Step 2: Add the Library JS**

Inside the main IIFE, after the chance-operations block and before `/* toggles */`, add:

```js
  /* ================= library (shared IndexedDB) ================= */
  function libStatus(msg){ const el=$("#libStatus"); el.textContent=msg||""; if(msg) setTimeout(()=>{ if(el.textContent===msg) el.textContent=""; }, 4000); }
  function sectionToTrackKeys(sec){
    return sec.keys.map(k=>({beat:k.beat, pose:JSON.parse(JSON.stringify(k.pose))}));
  }
  function fmtDate(ms){ const d=new Date(ms); return d.toLocaleDateString()+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }
  let librarySections=[];
  function refreshLibrary(){
    if(!window.SectionStore || !SectionStore.available()){
      $("#libraryList").innerHTML=`<p class="caption">This browser mode has no IndexedDB — the library is unavailable. JSON import/export in vid2grid still works.</p>`;
      return Promise.resolve();
    }
    return SectionStore.listSections().then(secs=>{
      librarySections=secs;
      if(!secs.length){ $("#libraryList").innerHTML=`<p class="caption">No sections yet — capture one in <a href="/">vid2grid</a>, or import JSON.</p>`; return; }
      $("#libraryList").innerHTML = secs.map(s=>
        `<div class="toolrow" style="border-bottom:1px solid var(--line);padding:6px 0">
          <span style="min-width:180px">${s.name.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</span>
          <span class="mono" style="font-size:11px">${s.beats} beats · ${s.keys.length} keys · ${Math.round(s.tempo)} bpm · ${fmtDate(s.createdAt)}</span>
          <span class="grow"></span>
          <button class="btn sm disp lib-add" data-id="${s.id}">→ choreography</button>
          <button class="btn sm disp lib-load" data-id="${s.id}">Load to track</button>
          <button class="btn sm disp lib-del" data-id="${s.id}">Delete</button>
        </div>`).join("");
    }).catch(e=>{ $("#libraryList").innerHTML=`<p class="caption">Library error: ${String(e).replace(/</g,"&lt;")}</p>`; });
  }
  $("#btnLibRefresh").addEventListener("click", refreshLibrary);
  $("#btnLibExport").addEventListener("click", ()=>{
    SectionStore.exportAll().then(data=>{
      const a=document.createElement("a");
      a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"}));
      a.download="movement-languages-library.json"; a.click(); URL.revokeObjectURL(a.href);
    }).catch(e=>libStatus(String(e)));
  });
  $("#libImport").addEventListener("change", e=>{
    const f=e.target.files && e.target.files[0]; if(!f) return;
    f.text().then(t=>SectionStore.importData(JSON.parse(t)))
      .then(r=>{ libStatus(`imported ${r.sections} section(s), ${r.choreographies} choreograph${r.choreographies===1?"y":"ies"}`); refreshLibrary(); })
      .catch(err=>libStatus("import failed: "+err));
    e.target.value="";
  });
  document.addEventListener("click", e=>{
    const load=e.target.closest(".lib-load");
    if(load){
      SectionStore.getSection(load.dataset.id).then(sec=>{
        if(!sec) return libStatus("section not found");
        const d=score.dancers[state.selD]; if(!d) return;
        d.keys=sectionToTrackKeys(sec);
        score.length=Math.max(8, sec.beats);
        score.tempo=Math.round(sec.tempo);
        state.selK=0; state.t=0; renderAll();
        libStatus(`loaded “${sec.name}” onto ${d.name}`);
      });
      return;
    }
    const del=e.target.closest(".lib-del");
    if(del){ SectionStore.deleteSection(del.dataset.id).then(()=>{ libStatus("deleted"); refreshLibrary(); }); return; }
  });
```

(`.lib-add` is wired in Task 8.)

At the bottom init, change `renderPalette(); renderAll();` to `renderPalette(); renderAll(); refreshLibrary();`.

Also widen the tempo slider to sections' range: on the `#tempoSlider` input element change `min="50"` to `min="30"` and `max="180"` to `max="200"`.

- [ ] **Step 3: Verify in the browser**

Dev server running. In vid2grid, save a section (Task 5 flow). Open `/movement-languages/danceforms.html`: the section is listed with beats/keys/bpm/date; **Load to track** replaces the selected dancer's keys and the stage/notations show the captured movement; **Delete** removes it; **Export JSON** downloads; re-**Import** restores it. Console clean.

- [ ] **Step 4: Commit**

```bash
git add public/movement-languages/danceforms.html
git commit -m "feat: danceforms library drawer over the shared IndexedDB"
```

---

### Task 8: Quarter-beat timeline + Choreography builder

**Files:**
- Modify: `public/movement-languages/danceforms.html`

**Interfaces:**
- Consumes: `SectionStore.buildChoreographyKeys`, `SectionStore.getSection/putChoreography/listChoreographies/deleteChoreography`, Task 7's `refreshLibrary`, `librarySections`, `libStatus`.
- Produces (page-internal): `chor` (current choreography object in the shared `Choreography` format), `renderChorItems()`, `buildChoreography()`, `saveChor()`.

- [ ] **Step 1: Quarter-beat support in existing interactions**

- `#btnAddKF` handler: change `const beat=Math.round(state.t);` to `const beat=Math.round(state.t*4)/4;`
- `nudge(dir)`: change `k.beat+dir` to `k.beat+dir*0.25` (quarter multiples are exact in floating point, so the existing `findIndex(k=>k.beat===beat)` equality stays safe).
- In `renderBeneshView`, the beats readout: replace
  `${beats} beat${beats===1?"":"s"}` with `${(+beats.toFixed(2))} beat${beats===1?"":"s"}`
  and the rhythm-dot count `Math.min(beats,8)` with `Math.max(1,Math.min(Math.round(beats),8))` (twice on that line).

- [ ] **Step 2: Choreography panel markup**

Directly after the Library panel from Task 7, insert:

```html
    <!-- choreography -->
    <div class="panel" style="margin-top:16px">
      <div class="panel-cap"><span class="dotk"></span><span>Choreography — sections in sequence</span><span class="capsp"></span>
        <select id="chorSelect" class="disp" aria-label="Saved choreographies" style="max-width:180px"></select>
        <button class="btn sm disp" id="btnChorNew">New</button>
        <button class="btn sm disp" id="btnChorDelete">Delete</button>
        <button class="btn sm disp" id="btnChorExport">Export JSON</button>
        <button class="btn disp" id="btnChorBuild">Build → selected dancer</button>
      </div>
      <div class="pad">
        <div class="toolrow" style="margin-bottom:8px">
          <span class="lab">Name</span>
          <input id="chorName" class="mono" style="font-size:12px;padding:4px 8px;background:var(--paper-2);border:1px solid var(--line);color:var(--ink)" aria-label="Choreography name">
          <span class="grow"></span>
          <span class="mono" id="chorTotal" style="font-size:11px"></span>
        </div>
        <div id="chorItems"><p class="caption">Empty — add sections from the library above.</p></div>
      </div>
    </div>
```

- [ ] **Step 3: Choreography JS** (after the library block from Task 7)

```js
  /* ================= choreography ================= */
  function newChor(){ return {v:1, id:(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)), name:"Choreography", tempo:0, items:[]}; }
  let chor=newChor();
  function chorSectionsById(){ const m={}; for(const s of librarySections) m[s.id]=s; return m; }
  function chorTotalBeats(){ return SectionStore.buildChoreographyKeys(chor.items, chorSectionsById()).totalBeats; }
  let chorSaveTimer=null;
  function saveChor(){
    clearTimeout(chorSaveTimer);
    chorSaveTimer=setTimeout(()=>{ if(chor.items.length||chor.name!=="Choreography") SectionStore.putChoreography(chor).then(refreshChorSelect).catch(()=>{}); },300);
  }
  function refreshChorSelect(){
    return SectionStore.listChoreographies().then(cs=>{
      $("#chorSelect").innerHTML=`<option value="">— open saved —</option>`+cs.map(c=>
        `<option value="${c.id}" ${c.id===chor.id?"selected":""}>${c.name.replace(/</g,"&lt;")}</option>`).join("");
    }).catch(()=>{});
  }
  function renderChorItems(){
    $("#chorName").value=chor.name;
    const byId=chorSectionsById();
    if(!chor.items.length){ $("#chorItems").innerHTML=`<p class="caption">Empty — add sections from the library above.</p>`; }
    else {
      $("#chorItems").innerHTML=chor.items.map((it,i)=>{
        const sec=byId[it.sectionId];
        const label=sec? `${sec.name.replace(/</g,"&lt;")} <span class="mono" style="font-size:11px">(${sec.beats} beats)</span>`
                       : `<em>missing section</em> <span class="mono" style="font-size:11px">${it.sectionId.slice(0,8)}…</span>`;
        return `<div class="toolrow" style="border-bottom:1px solid var(--line);padding:5px 0">
          <span class="mono" style="font-size:11px">${i+1}.</span><span>${label}</span>
          <span class="grow"></span>
          <span class="lab">×</span><input type="number" class="chor-rep mono" data-i="${i}" min="1" max="8" value="${it.repeat}" style="width:3.2em" aria-label="Repeats">
          <button class="btn sm disp chor-up" data-i="${i}" ${i===0?"disabled":""}>↑</button>
          <button class="btn sm disp chor-down" data-i="${i}" ${i===chor.items.length-1?"disabled":""}>↓</button>
          <button class="btn sm disp chor-rm" data-i="${i}">✕</button>
        </div>`;
      }).join("");
    }
    $("#chorTotal").textContent = chor.items.length? `total ${chorTotalBeats()} beats` : "";
  }
  function buildChoreography(){
    const {keys,totalBeats,missing}=SectionStore.buildChoreographyKeys(chor.items, chorSectionsById());
    if(!keys.length){ libStatus("nothing to build"); return; }
    const d=score.dancers[state.selD]; if(!d) return;
    d.keys=keys;
    score.length=Math.max(8, Math.ceil(totalBeats));
    if(chor.tempo>0) score.tempo=Math.round(chor.tempo);
    state.selK=0; state.t=0; renderAll();
    libStatus(missing.length? `built — ${missing.length} missing section(s) skipped` : `built ${totalBeats} beats onto ${d.name}`);
  }
  document.addEventListener("click", e=>{
    const add=e.target.closest(".lib-add");
    if(add){
      const sec=chorSectionsById()[add.dataset.id];
      chor.items.push({sectionId:add.dataset.id, repeat:1});
      if(!chor.tempo && sec) chor.tempo=sec.tempo;
      renderChorItems(); saveChor(); return;
    }
    const up=e.target.closest(".chor-up"), down=e.target.closest(".chor-down"), rm=e.target.closest(".chor-rm");
    if(up||down){
      const i=+((up||down).dataset.i), j=up? i-1 : i+1;
      const t=chor.items[i]; chor.items[i]=chor.items[j]; chor.items[j]=t;
      renderChorItems(); saveChor(); return;
    }
    if(rm){ chor.items.splice(+rm.dataset.i,1); renderChorItems(); saveChor(); return; }
  });
  document.addEventListener("input", e=>{
    if(e.target.classList && e.target.classList.contains("chor-rep")){
      const i=+e.target.dataset.i;
      chor.items[i].repeat=Math.max(1,Math.min(8,Math.round(+e.target.value||1)));
      $("#chorTotal").textContent=`total ${chorTotalBeats()} beats`; saveChor();
    }
  });
  $("#chorName").addEventListener("input", e=>{ chor.name=e.target.value||"Choreography"; saveChor(); });
  $("#btnChorNew").addEventListener("click", ()=>{ chor=newChor(); renderChorItems(); refreshChorSelect(); });
  $("#btnChorDelete").addEventListener("click", ()=>{
    SectionStore.deleteChoreography(chor.id).then(()=>{ chor=newChor(); renderChorItems(); refreshChorSelect(); libStatus("choreography deleted"); }).catch(()=>{});
  });
  $("#chorSelect").addEventListener("change", e=>{
    if(!e.target.value) return;
    SectionStore.getChoreography(e.target.value).then(c=>{ if(c){ chor=c; renderChorItems(); } });
  });
  $("#btnChorExport").addEventListener("click", ()=>{
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([JSON.stringify(chor)],{type:"application/json"}));
    a.download=(chor.name.replace(/\s+/g,"-")||"choreography")+".choreography.json"; a.click(); URL.revokeObjectURL(a.href);
  });
  $("#btnChorBuild").addEventListener("click", buildChoreography);
```

Update the init line to: `renderPalette(); renderAll(); refreshLibrary().then(()=>{ renderChorItems(); refreshChorSelect(); });`
In Task 7's `.lib-del` handler, add `renderChorItems();` after `refreshLibrary();` so a deleted section immediately shows as missing in the choreography list.

- [ ] **Step 4: Verify in the browser**

Save two different sections from vid2grid. In the studio: add both to the choreography (order them, set a repeat of 2 on one), total beats reads Σ beats×repeat; **Build** writes them onto the selected dancer — the timeline shows keys at quarter positions, playback flows through both sections, the Laban/Benesh/E-W views render the sequence; reload the page — the choreography reappears via the select. Add-keyframe at a fractional playhead lands on a quarter beat; nudge moves by ¼.

- [ ] **Step 5: Commit**

```bash
git add public/movement-languages/danceforms.html
git commit -m "feat: choreography builder — sequence sections with repeats onto the score"
```

---

### Task 9: Video capture

**Files:**
- Modify: `public/movement-languages/danceforms.html`

**Interfaces:**
- Consumes: existing `state`, `tickPlay`, `#stageCanvas`, `#btnPlay`; `chor.name`.
- Produces: a `⏺ Capture` transport button that records one full pass of playback from beat 0 and downloads it.

- [ ] **Step 1: Markup** — in the Transport toolrow, after `#btnLoop`, add:

```html
          <button class="btn sm disp" id="btnCapture" title="record one pass of playback to a video file">⏺ Capture</button>
```

- [ ] **Step 2: JS** (near the playback code)

```js
  /* ================= video capture ================= */
  const CAPTURE_MIME=(typeof MediaRecorder!=="undefined")?
    ["video/mp4;codecs=avc1","video/webm;codecs=vp9","video/webm"].find(m=>MediaRecorder.isTypeSupported(m)):null;
  let captureRec=null, captureWasLoop=true;
  (function(){
    const btn=$("#btnCapture"), cv=$("#stageCanvas");
    if(!CAPTURE_MIME || !cv.captureStream){ btn.disabled=true; btn.title="MediaRecorder canvas capture is not supported in this browser"; return; }
    btn.addEventListener("click", ()=>{
      if(captureRec) return;
      const chunks=[];
      captureRec=new MediaRecorder(cv.captureStream(60),{mimeType:CAPTURE_MIME});
      captureRec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
      captureRec.onstop=()=>{
        const ext=CAPTURE_MIME.indexOf("mp4")>=0?"mp4":"webm";
        const a=document.createElement("a");
        a.href=URL.createObjectURL(new Blob(chunks,{type:CAPTURE_MIME}));
        a.download=(chor.name.replace(/\s+/g,"-")||"choreography")+"."+ext; a.click(); URL.revokeObjectURL(a.href);
        captureRec=null; state.loop=captureWasLoop; $("#btnLoop").setAttribute("aria-pressed",state.loop);
        btn.textContent="⏺ Capture";
      };
      captureWasLoop=state.loop; state.loop=false;
      state.t=0; btn.textContent="⏹ recording…";
      captureRec.start();
      if(!state.playing) $("#btnPlay").click();
    });
  })();
```

In `tickPlay`, in the non-loop end branch (`else { state.t=score.length; state.playing=false; ... }`) append:

```js
        if(captureRec){ try{ captureRec.stop(); }catch(err){} }
```

- [ ] **Step 3: Verify in the browser**

Build a choreography, click **⏺ Capture**: playback runs once from beat 0, then a `.webm` (or `.mp4` on Safari) downloads and plays in a video player showing the stage animation. Loop state is restored afterwards.

- [ ] **Step 4: Commit**

```bash
git add public/movement-languages/danceforms.html
git commit -m "feat: capture stage playback to video via MediaRecorder"
```

---

### Task 10: Finer directions — Laban 16 + pins, E-W half-units

**Files:**
- Modify: `public/movement-languages/danceforms.html`

**Interfaces:**
- Consumes: existing `labanOf`, `labanToVec`, `labanSymbol`, `renderLabanView`, `renderLabanTools`, `DIR8`, `DIR_ARROW`, the `[data-ldir]`/`[data-llevel]` click handlers, the `[data-ewstep]` handler and its HTML buttons.
- Produces: Laban quant `q = {dir, level, pin}` where `dir` ∈ 16 names, `pin` ∈ {−1, 0, 1} (±22.5° level deviation); E-W stepping in 22.5° half-units. Benesh is untouched (verified continuous already).

- [ ] **Step 1: 16-direction Laban quantization**

Replace `DIR8`/`labanOf`/`labanToVec` block with:

```js
  const DIR8=["forward","rf","right","rb","back","lb","left","lf"];
  const DIR16=["forward","f/rf","rf","rf/r","right","r/rb","rb","rb/b","back","b/lb","lb","lb/l","left","l/lf","lf","lf/f"];
  const DIR_ARROW={forward:"↑",rf:"↗",right:"→",rb:"↘",back:"↓",lb:"↙",left:"←",lf:"↖",place:"●",
    "f/rf":"↑↗","rf/r":"↗→","r/rb":"→↘","rb/b":"↘↓","b/lb":"↓↙","lb/l":"↙←","l/lf":"←↖","lf/f":"↖↑"};
  function labanOf(v){
    const ae=dirToAzEl(v), az=ae[0], el=ae[1];
    if(el>67.5) return {dir:"place",level:"high",pin:0};
    if(el<-67.5) return {dir:"place",level:"low",pin:0};
    const level = el>22.5?"high": el<-22.5?"low":"middle";
    const base={high:45,middle:0,low:-45}[level];
    const pin = (el-base)>11.25? 1 : (el-base)<-11.25? -1 : 0;
    const i16=((Math.round(az/22.5)%16)+16)%16;
    return {dir:DIR16[i16], level, pin};
  }
  function labanToVec(q){
    if(q.dir==="place") return q.level==="high"? {x:0,y:1,z:0}: {x:0,y:-1,z:0};
    const el={low:-45,middle:0,high:45}[q.level] + (q.pin||0)*22.5;
    return vec(DIR16.indexOf(q.dir)*22.5, el);
  }
```

- [ ] **Step 2: Render combined symbols + pin marks**

In `renderLabanView`, replace the single `labanSymbol` call for un-held slots (the `if(!held) g+=…` line) with the block below; keep the existing `else` branch (the dashed hold line) unchanged:

```js
        if(!held){
          const i16=DIR16.indexOf(q.dir);
          const h=Math.max(8,(y1-y0)-4);
          let sym;
          if(q.dir==="place"||i16%2===0) sym=labanSymbol(q.dir==="place"?"place":DIR8[i16/2],q.level,x,y0+2,symW,h,p[0]==="l");
          else sym=labanSymbol(DIR8[((i16-1)/2)%8],q.level,x,y0+2,symW/2,h,p[0]==="l")
                  +labanSymbol(DIR8[(((i16+1)/2))%8],q.level,x+symW/2,y0+2,symW/2,h,p[0]==="l");
          if(q.pin) sym+=`<path d="M${x+symW/2-3.5},${q.pin>0?y0+6:y0+h-2} l3.5,${q.pin>0?-4:4} l3.5,${q.pin>0?4:-4}" fill="none" style="stroke:var(--ink);stroke-width:1.3"/>`;
          g+=`<g style="pointer-events:none">${sym}</g>`;
        }
```

(the `held` comparison `JSON.stringify(q)` keeps working since `q` gained only `pin`.)

- [ ] **Step 3: Editing — intermediate rose + pin buttons**

In `renderLabanTools`, after the existing rose/levels, render intermediates and pins:

```js
    $("#labanRose16").innerHTML=DIR16.filter((d,i)=>i%2===1).map(dd=>
      `<button class="opt" data-ldir="${dd}" aria-pressed="${q&&q.dir===dd}" title="between ${dd.replace("/"," and ")}">${DIR_ARROW[dd]}</button>`).join("");
    $("#labanPins").innerHTML=[["-1","−¼"],["0","·"],["1","+¼"]].map(([v,l])=>
      `<button class="opt" data-lpin="${v}" aria-pressed="${q&&String(q.pin)===v}" title="level ${v==="0"?"exact":"raised/lowered a half step"}">${l}</button>`).join("");
```

Markup: in the `#labanTools` toolrow, after `#labanLevels` add:

```html
        <span class="lab" style="margin-left:14px">Between</span>
        <span class="optrow" id="labanRose16"></span>
        <span class="lab" style="margin-left:14px">Pin</span>
        <span class="optrow" id="labanPins"></span>
```

Click handler: next to the existing `[data-llevel]` branch add:

```js
    const lpin=e.target.closest("[data-lpin]");
    if(lpin){
      const k=selKey(); if(!k) return;
      const q=labanOf(limbVec(k.pose,state.selPart));
      if(q.dir==="place") return;
      q.pin=+lpin.dataset.lpin;
      setLimbVec(k.pose,state.selPart,labanToVec(q));
      snapSel(); renderAll(); return;
    }
```

The existing `[data-ldir]` handler already works for 16 names (it sets `q.dir` from the dataset). Update the panel caption `Labanotation — click a slot on the staff, then set it with the rose` to `Labanotation — 16 directions; a chevron pins the level a half step up or down`.

- [ ] **Step 4: E-W half-units**

In the `[data-ewstep]` click handler change both `45` step values to `22.5`. In the `#ewTools` markup change button titles to `+22.5° elevation` / `−22.5° elevation` / `−22.5° azimuth` / `+22.5° azimuth` and the panel caption to `Eshkol-Wachman — click a cell, then step it in 22.5° half-units`. In `renderEWView`'s footnote line change `45° units` to `45° units, half units shown as .5` (the cell text already renders halves via `toFixed(1)`).

- [ ] **Step 5: Verify in the browser**

Load a captured section to a track. Laban staff shows half-width paired symbols where limbs sit between the 8 directions, and chevron pins for ±22.5° levels; clicking an intermediate rose button sets a between-direction; pin buttons shift level by a half step and the stage follows. E-W step buttons move cells by 0.5 in the grid readout. Benesh unchanged and signs still draggable.

- [ ] **Step 6: Commit**

```bash
git add public/movement-languages/danceforms.html
git commit -m "feat: finer notation resolution — Laban 16 dirs + level pins, E-W half-units"
```

---

### Task 11: index.html library picker

**Files:**
- Modify: `public/movement-languages/index.html`

**Interfaces:**
- Consumes: `window.SectionStore`; page internals `state`, `renderAll()`, `DIRS`, `LEVELS`.
- Produces (page-internal): `sectionToPhrase(section)` → array of `{limb, dir, level, beats, time, weight}` events; a picker in `.phrase-tools`.

- [ ] **Step 1: Markup** — in the `.phrase-tools` div after `#playClock`, add:

```html
      <span class="grow"></span>
      <select id="libPick" class="disp" aria-label="Sections from the library" style="max-width:180px"></select>
      <button class="btn disp" id="btnLibLoad">Load section</button>
      <span class="sec-sub mono" id="libNote"></span>
```

- [ ] **Step 2: JS** — inside the main IIFE, before the final `renderAll();` init call, add:

```js
  /* ============ library picker: a section, compressed into this page's model ============ */
  const SEG_LIMBS={RA:["ruarm","rfarm"],LA:["luarm","lfarm"],RL:["rthigh","rshin"],LL:["lthigh","lshin"]};
  const SEG_LEN={ruarm:.27,rfarm:.25,luarm:.27,lfarm:.25,rthigh:.42,rshin:.40,lthigh:.42,lshin:.40};
  const DIR_KEYS=["forward","rf","right","rb","back","lb","left","lf"];
  function aeVec(az,el){ const a=az*Math.PI/180,e=el*Math.PI/180;
    return {x:Math.sin(a)*Math.cos(e), y:Math.sin(e), z:Math.cos(a)*Math.cos(e)}; }
  function limbV(pose,ids){
    let x=0,y=0,z=0;
    for(const id of ids){ const v=aeVec(pose.bones[id][0],pose.bones[id][1]), L=SEG_LEN[id]; x+=v.x*L; y+=v.y*L; z+=v.z*L; }
    const m=Math.hypot(x,y,z)||1; return {x:x/m,y:y/m,z:z/m};
  }
  function angleBetween(a,b){ return Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y+a.z*b.z)))*180/Math.PI; }
  function eventOf(limb,v,beats){
    const az=Math.atan2(v.x,v.z)*180/Math.PI, el=Math.asin(Math.max(-1,Math.min(1,v.y)))*180/Math.PI;
    const dir = Math.abs(el)>67.5? "place" : DIR_KEYS[((Math.round(az/45)%8)+8)%8];
    const level = dir==="place"? (el>0?"high":"low") : el>22.5?"high": el<-22.5?"low":"middle";
    return {limb, dir, level, beats, time: beats<=0.5?"sudden":"sustained", weight:"light"};
  }
  function sectionToPhrase(sec){
    const ks=sec.keys, ev=[];
    if(ks.length===1){
      ev.push(eventOf("RA", limbV(ks[0].pose,SEG_LIMBS.RA), sec.beats));
      return ev;
    }
    for(let i=1;i<ks.length;i++){
      let best="RA", bestA=-1;
      for(const limb in SEG_LIMBS){
        const a=angleBetween(limbV(ks[i-1].pose,SEG_LIMBS[limb]), limbV(ks[i].pose,SEG_LIMBS[limb]));
        if(a>bestA){ bestA=a; best=limb; }
      }
      ev.push(eventOf(best, limbV(ks[i].pose,SEG_LIMBS[best]), ks[i].beat-ks[i-1].beat));
    }
    const tail=sec.beats-ks[ks.length-1].beat;
    if(tail>0){ const last=ev[ev.length-1]; ev.push(Object.assign({},last,{beats:tail,time:"sustained"})); }
    return ev;
  }
  (function(){
    const pick=$("#libPick"), btn=$("#btnLibLoad"), note=$("#libNote");
    if(!window.SectionStore || !SectionStore.available()){ pick.style.display="none"; btn.style.display="none"; return; }
    SectionStore.listSections().then(secs=>{
      pick.innerHTML=`<option value="">— from the library —</option>`+secs.map(s=>
        `<option value="${s.id}">${s.name.replace(/</g,"&lt;")} (${s.beats} beats)</option>`).join("");
    }).catch(()=>{ pick.style.display="none"; btn.style.display="none"; });
    btn.addEventListener("click", ()=>{
      if(!pick.value) return;
      SectionStore.getSection(pick.value).then(sec=>{
        if(!sec) return;
        state.phrase=sectionToPhrase(sec);
        state.selected=0; state.t=0;
        note.textContent=`“${sec.name}” — compressed to 4 channels × 8 dirs × 3 levels`;
        renderAll();
      });
    });
  })();
```

- [ ] **Step 3: Verify in the browser**

With a saved section: pick it, **Load section** — the phrase timeline, Laban, Benesh, E-W and correspondence views all re-render from the compressed events; fractional beat durations lay out correctly; the note names the compression; Play animates. Chance-cast still works afterwards.

- [ ] **Step 4: Commit**

```bash
git add public/movement-languages/index.html
git commit -m "feat: parameters page loads a library section, compressed to its 4-channel model"
```

---

### Task 12: End-to-end test + docs

**Files:**
- Create: `scripts/e2e-sections.mjs`
- Modify: `package.json`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above through the browser.
- Produces: `npm run e2e` (requires dev server on :3000 and Chromium installed).

- [ ] **Step 1: Install Playwright**

```bash
npm install -D playwright
npx playwright install chromium
```

Add script: `"e2e": "node scripts/e2e-sections.mjs"`.

- [ ] **Step 2: Write `scripts/e2e-sections.mjs`**

```js
/* End-to-end: synthetic score JSON → import into vid2grid → save a section →
   danceforms library → choreography build → quarter-beat keys.
   Requires the dev server on http://localhost:3000 and `npx playwright install chromium`. */
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BONE_IDS = ["torso","shoulders","head","ruarm","rfarm","rhand","luarm","lfarm","lhand","rthigh","rshin","rfoot","lthigh","lshin","lfoot"];
const LENS = { torso:.48, shoulders:.36, head:.24, ruarm:.28, rfarm:.26, rhand:.1, luarm:.28, lfarm:.26, lhand:.1, rthigh:.44, rshin:.42, rfoot:.16, lthigh:.44, lshin:.42, lfoot:.16 };

function pose(t, swing) {
  const bones = {};
  for (const id of BONE_IDS) bones[id] = id === "ruarm" || id === "luarm" ? [swing, -20] : [0, id.includes("thigh") || id.includes("shin") ? -85 : 45];
  bones.torso = [0, 86]; bones.head = [0, 76]; bones.shoulders = [90, 0];
  return { t, facing: 0, x: 0, z: 0, hipY: 0.95, bones, conf: 0.9 };
}
function synthScore() {
  const fps = 30, duration = 4, n = fps * duration;
  // Arms swap between +80° and −80° azimuth every 0.5 s → keyframes at 120 bpm.
  const raw = Array.from({ length: n }, (_, i) => pose(i / fps, Math.floor((i / fps) / 0.5) % 2 ? 80 : -80));
  return {
    version: 1,
    source: { name: "synthetic.mp4", duration, fps, width: 640, height: 480 },
    grid: { azStep: 22.5, elStep: 22.5, hysteresis: 0.3, minDwell: 4, facingStep: 45 },
    smooth: { minCutoff: 1.5, beta: 1.0 },
    lift: "anchored",
    body: { lengths: LENS, hipWidth: 0.22, shoulderWidth: 0.36 },
    raw, frames: raw, keyframes: [0],
  };
}

const die = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const dir = mkdtempSync(join(tmpdir(), "v2g-e2e-"));
const scorePath = join(dir, "synthetic.vid2grid.json");
writeFileSync(scorePath, JSON.stringify(synthScore()));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => die("page error: " + e));

await page.goto("http://localhost:3000");
await page.setInputFiles('input[accept*="json"]', scorePath);
await page.waitForSelector("text=section — quantized", { timeout: 15000 });
await page.fill('input[aria-label="Section name"]', "e2e section");
await page.click("text=save to library");
await page.waitForSelector("text=saved “e2e section”", { timeout: 5000 });

await page.goto("http://localhost:3000/movement-languages/danceforms.html");
await page.waitForSelector("#libraryList >> text=e2e section", { timeout: 5000 });
await page.click(".lib-add");
await page.click(".lib-add");
await page.click("#btnChorBuild");
await page.waitForTimeout(500);

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("danceforms-score-v1")));
const keys = stored.dancers[0].keys;
if (keys.length < 4) die(`expected ≥4 built keys, got ${keys.length}`);
if (!keys.every((k) => Math.round(k.beat * 4) === k.beat * 4)) die("keys not on quarter beats: " + keys.map((k) => k.beat));
const total = await page.textContent("#chorTotal");
if (!/total \d+ beats/.test(total || "")) die("total beats readout missing");

console.log(`PASS: ${keys.length} keys on quarter beats, ${total}`);
await browser.close();
```

- [ ] **Step 3: Run it**

Start the dev server if not running (`npm run dev` in the background), then:

Run: `npm run e2e`
Expected: `PASS: N keys on quarter beats, total M beats` — N and M depend on how the synthetic swing snaps and on the estimated section length (likely 7–8 beats per repeat), so assert only what the script asserts: ≥4 keys, all on quarter beats, a numeric total. Fix selectors, not sleeps, if it flakes.

- [ ] **Step 4: Docs**

`README.md` — add a section after "Changeable parameters":

```markdown
## Sections & the studio

Once a clip is analyzed, the **section** panel (right column) estimates the
clip's tempo from the motion (always adjustable: slider, tap, ⅛-beat offset
nudges), snaps the score's keyframes to the nearest **quarter-beat**, and lets
you drag out a window of up to **8 beats**. Save it to the browser's library
(IndexedDB, shared across this origin) or download it as JSON.

The static pages under `public/movement-languages/` are the companion site:

- `/movement-languages/danceforms.html` — the studio: a **library** of saved
  sections, a **choreography** builder that sequences sections (with repeats)
  onto a dancer track, playback, editable Labanotation (16 directions + level
  pins) / Benesh / Eshkol-Wachman (22.5° half-units) renderings, JSON export,
  and **⏺ Capture** — records a playback pass to a video file.
- `/movement-languages/index.html` — the parameters page; can load a section
  from the library, compressed into its four-channel comparison model.

The shared format and DB schema live in `lib/sectionize.ts` / `lib/sectionsDb.ts`
with a vanilla twin at `public/movement-languages/section-store.js` — change
one, change both. Tests: `npm test` (node:test) and `npm run e2e` (Playwright,
needs the dev server + `npx playwright install chromium`).
```

`CLAUDE.md` — add one bullet:

```markdown
- Sections/choreography: `lib/sectionize.ts` + `lib/sectionsDb.ts` have a deliberately duplicated vanilla twin in `public/movement-languages/section-store.js` (static pages can't import from the app) — keep the schema in step. The static pages under `public/movement-languages/` are copies; the originals in `../` are not touched. `npm test` runs node:test units; `npm run e2e` needs the dev server.
```

- [ ] **Step 5: Full verification sweep**

Run: `npx tsc --noEmit -p .` · `npx eslint .` · `npm test` · `npm run e2e` · `npm run build` — all green.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e-sections.mjs package.json package-lock.json README.md CLAUDE.md
git commit -m "test: end-to-end section→choreography flow; document the pipeline"
```
