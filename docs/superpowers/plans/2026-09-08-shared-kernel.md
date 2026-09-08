# Shared Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `danceforms.html` (Studio) and `comparison.html` share one pose/geometry kernel defined in `notation-render.js`, deleting Studio's 171 lines of duplicated definitions.

**Architecture:** `notation-render.js` is a UMD module already loaded by Comparison and `require()`d by node tests. Four groups of symbols move *up* into it from Studio (`nlerp`/`lerp`/`lerpAngle`/`smooth`, `poseAt`, `mkPose`, `labanToVec`); the rest of the kernel is already there verbatim. Studio then loads the module and rebinds all 30 kernel symbols with one destructuring preamble, so its remaining ~2000 lines keep every existing call site unchanged.

**Tech Stack:** Vanilla ES2020, UMD modules, no build step. Tests: `node:test` (`npm test`). E2E: Playwright driving the Next dev server on :3000 (`npm run e2e`).

**Spec:** `docs/superpowers/specs/2026-09-08-shared-kernel-design.md`

## Global Constraints

- **This is a pure refactor. No behaviour may change.** Every moved line is copied verbatim; no reformatting, no "improvements", no renames.
- **Never edit `../standalone/`.** It is a deliberately diverged no-build edition (README.md, CLAUDE.md). Out of scope entirely.
- **Do not touch the three renderers** (`renderLabanView`, `renderBeneshView`, `renderEWView`, `renderLabanTools`, `renderBeneshTools`, `renderEWTools`) in `danceforms.html`, or `renderLaban`/`renderBenesh`/`renderEW` in `notation-render.js`. They stay duplicated by design.
- **Do not unify the pose constructors.** `standPose`/`merge` stay Comparison-only; `mkPose` is added alongside them, not merged with them. Same for `SEG_TO_LABANCOL`/`segToLabanCol`, which stay Comparison-only and are not imported by Studio.
- **The eight Comparison invariants in `CLAUDE.md` are unchanged by this work.** If a step seems to require changing one, stop and ask.
- All work happens on branch `editor` in `/Users/galgo/Documents/movement-languages/vid2grid`.
- Line numbers in this plan refer to the files **as they are at the start of Task 5**. Tasks 1–4 do not modify `danceforms.html`, so they stay valid until then.

## The 30 kernel symbols

This exact list is used in Task 4's test and Task 5's preamble. Keep them identical.

```
BONES BONE STAND clonePose mkPose
D2R vec rotY nlerp lerp lerpAngle smooth dirToAzEl poseAt skeleton
LIMBSETS limbVec setLimbVec limbLen
DIR8 DIR16 DIR_ARROW labanOf labanToVec hatchDef labanSymbol LABAN_COLS labanQuantAt
beneshDepthOf ewCoord
```

---

### Task 1: Studio characterization e2e

**A refactor inverts normal TDD.** This test must **PASS before** the refactor (proving it describes Studio's real behaviour) and **still pass after** (proving nothing broke). Do not expect a red phase. A test that fails here means the test is wrong, not Studio.

**Files:**
- Create: `scripts/e2e-studio.mjs`
- Modify: `package.json` (the `e2e` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run e2e` includes `node scripts/e2e-studio.mjs`. Tasks 5 and 6 rerun it as their gate.

- [ ] **Step 1: Start the dev server if it is not already up**

```bash
cd /Users/galgo/Documents/movement-languages/vid2grid
curl -sSf -o /dev/null http://localhost:3000/movement-languages/danceforms.html && echo "server already up" || npm run dev
```

If you started it, leave it running in a separate terminal and wait for "Ready".

- [ ] **Step 2: Write the characterization test**

Create `scripts/e2e-studio.mjs`. Studio autosaves its score to `localStorage["danceforms-score-v1"]`, so the test clears that key before load to guarantee the built-in `demoScore()` — otherwise it silently tests whatever score the last human left behind.

```js
/* End-to-end: DanceForms Studio smoke test. Requires the dev server on :3000.
   This is a CHARACTERIZATION test for the shared-kernel refactor (spec
   2026-09-08): it passes before the refactor and must still pass after. Its
   most valuable assertion is the zero-page-errors one — a missing kernel
   export or a bad script load order shows up there first. */
import { chromium } from "playwright";
const URL = "http://localhost:3000/movement-languages/danceforms.html";
const die = (m) => { throw new Error(m); };
const browser = await chromium.launch();
let exitCode = 0;
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  // Force the built-in demo score: Studio restores an autosaved score if present.
  await page.addInitScript(() => { try { localStorage.removeItem("danceforms-score-v1"); } catch { /* private mode */ } });
  await page.goto(URL, { waitUntil: "networkidle" });

  // 1. The kernel loaded and every symbol resolved.
  if (errs.length) die("page errors on load: " + errs.join(" | "));

  // 2. The demo score rendered into all three notation views.
  for (const id of ["labanView", "beneshView", "ewView"]) {
    const html = await page.$eval("#" + id, (el) => el.innerHTML);
    if (!/^<svg/.test(html)) die(`#${id} did not render an svg`);
  }
  // Laban draws real symbol geometry, not just an empty staff.
  const laban = await page.$eval("#labanView", (el) => el.innerHTML);
  if (!/path d="M/.test(laban)) die("#labanView has no symbol paths");

  // 3. The stage canvas painted something (not a blank canvas).
  const painted = await page.$eval("#stageCanvas", (cv) => {
    const ctx = cv.getContext("2d");
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  });
  if (!painted) die("#stageCanvas is blank");

  // 4. The pose palette built its buttons.
  const poses = await page.$$eval("#palette button[data-preset]", (els) => els.length);
  if (poses < 5) die(`pose palette has only ${poses} entries`);

  // 5. Playback advances the beat readout, then pauses.
  const t0 = await page.$eval("#beatReadout", (el) => el.textContent);
  await page.click("#btnPlay");
  await page.waitForFunction(
    (before) => document.querySelector("#beatReadout").textContent !== before,
    t0, { timeout: 4000 },
  ).catch(() => die("playback did not advance #beatReadout"));
  await page.click("#btnPlay");

  // 6. poseAt interpolates: scrubbing to a non-key beat repaints the stage.
  //    #tlScrub is an SVG <rect>, not a range input — Studio scrubs on
  //    pointerdown (danceforms.html:1857), so click it at a fraction across.
  const shot0 = await page.locator("#stageCanvas").screenshot();
  const box = await page.locator("#tlScrub").boundingBox();
  if (!box) die("#tlScrub not found");
  await page.mouse.click(box.x + box.width * 0.37, box.y + box.height / 2);
  const shot1 = await page.locator("#stageCanvas").screenshot();
  if (Buffer.compare(shot0, shot1) === 0) die("scrubbing the timeline did not repaint the stage");

  // 7. Applying a palette pose rewrites the Laban view (exercises setLimbVec +
  //    labanQuantAt + labanSymbol end to end).
  const labanBefore = await page.$eval("#labanView", (el) => el.innerHTML);
  await page.click('#palette button[data-preset="3"]');   // "Plié"
  const labanAfter = await page.$eval("#labanView", (el) => el.innerHTML);
  if (labanBefore === labanAfter) die("applying a palette pose did not change #labanView");

  // 8. Still no errors after all that interaction.
  if (errs.length) die("page errors after interaction: " + errs.join(" | "));

  console.log("e2e-studio: OK");
} catch (e) {
  console.error("e2e-studio FAILED:", e.message);
  exitCode = 1;
} finally {
  await browser.close();
  process.exit(exitCode);
}
```

- [ ] **Step 3: Run it against UNREFACTORED Studio — it must PASS**

Run: `node scripts/e2e-studio.mjs`
Expected: `e2e-studio: OK`, exit 0.

If any assertion fails, the assertion is wrong about Studio — fix the test, not `danceforms.html`. Do not weaken an assertion to make it pass; fix the mechanism so it genuinely exercises Studio.

Two selectors were verified against the current file and are worth re-checking if this fails: `#tlScrub` is an SVG `<rect>` scrubbed on `pointerdown` (`danceforms.html:810` and `:1857`), and the palette renders `<button class="pose-card" data-preset="N">` (`:766`).

- [ ] **Step 4: Wire it into `npm run e2e`**

In `package.json`, change the `e2e` script to:

```json
"e2e": "node scripts/e2e-sections.mjs && node scripts/e2e-comparison.mjs && node scripts/e2e-studio.mjs",
```

- [ ] **Step 5: Run the full e2e suite**

Run: `npm run e2e`
Expected: all three scripts pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e-studio.mjs package.json
git commit -m "test: characterization e2e for Studio before the kernel refactor"
```

---

### Task 2: Capture the SVG regression baseline

Throwaway verification, not a committed test. The kernel is copied verbatim, so the three notation views must render **byte-identically** after the refactor. Any difference is a mistake.

**Files:**
- Create: `$WS/baseline-studio-svg.mjs` and `$WS/baseline-before.json`, where `$WS` is the plan's gitignored workspace `/Users/galgo/Documents/movement-languages/vid2grid/.superpowers/sdd/2026-09-08-shared-kernel`. Nothing in this task is committed.

> **The script must live INSIDE the repo, not in a system temp directory.** Node
> resolves bare imports like `playwright` from the importing file's own directory
> upward, so a copy under `/tmp` dies with `ERR_MODULE_NOT_FOUND` no matter what
> `cwd` you run it from. `.superpowers/sdd/...` is inside the repo (so it resolves
> `vid2grid/node_modules`) and is gitignored (so it still commits nothing).

**Interfaces:**
- Consumes: the dev server from Task 1.
- Produces: `$WS/baseline-before.json`, compared against in Task 5 Step 6.

- [ ] **Step 1: Write the capture script**

```bash
WS=/Users/galgo/Documents/movement-languages/vid2grid/.superpowers/sdd/2026-09-08-shared-kernel
cat > "$WS/baseline-studio-svg.mjs" <<'EOF'
/* Throwaway: dump Studio's three notation views for the demo score, so the
   shared-kernel refactor can be proven byte-identical. Usage:
     node baseline-studio-svg.mjs <output.json> */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "baseline.json";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { try { localStorage.removeItem("danceforms-score-v1"); } catch {} });
await page.goto("http://localhost:3000/movement-languages/danceforms.html", { waitUntil: "networkidle" });
const views = {};
for (const id of ["labanView", "beneshView", "ewView"]) {
  views[id] = await page.$eval("#" + id, (el) => el.innerHTML);
}
writeFileSync(out, JSON.stringify(views, null, 2));
console.log("captured", Object.entries(views).map(([k, v]) => `${k}:${v.length}b`).join(" "));
await browser.close();
EOF
```

- [ ] **Step 2: Capture the baseline**

```bash
cd /Users/galgo/Documents/movement-languages/vid2grid
WS=/Users/galgo/Documents/movement-languages/vid2grid/.superpowers/sdd/2026-09-08-shared-kernel
node "$WS/baseline-studio-svg.mjs" "$WS/baseline-before.json"
```

Expected: `captured labanView:NNNNb beneshView:NNNNb ewView:NNNNb`, all three non-zero.

- [ ] **Step 3: Confirm the file is non-trivial**

```bash
wc -c "$WS/baseline-before.json"
```

Expected: several kilobytes. If it is under 500 bytes the views did not render — stop and diagnose before refactoring.

*(No commit — this is scratch data.)*

---

### Task 3: Move the interpolation primitives, `poseAt`, `mkPose` and `labanToVec` into the kernel

Genuine TDD: these four groups do not exist in `notation-render.js`, so the tests **fail first**.

**Files:**
- Modify: `public/movement-languages/notation-render.js`
- Test: `test/notation.test.mjs`

**Interfaces:**
- Consumes: existing `NotationRender` exports (`standPose`, `clonePose`, `BONES`, `vec`, `dirToAzEl`, `DIR16`).
- Produces, on the `NotationRender` module object:
  - `nlerp(a, b, u) -> {x,y,z}` — normalized linear blend of two vectors.
  - `lerp(a, b, u) -> number`
  - `lerpAngle(a, b, u) -> number` — degrees, short way around.
  - `smooth(u) -> number` — smoothstep easing.
  - `poseAt(dancer, t) -> pose` — full interpolated pose (bones + `hipY`/`x`/`z`/`facing`).
  - `mkPose(over) -> pose` — `STAND` with `{hipY?, bones?}` overrides applied.
  - `labanToVec(q) -> {x,y,z}` — inverse of `labanOf`; `q` is `{dir, level, pin}`.

- [ ] **Step 1: Write the failing tests**

Append to `test/notation.test.mjs`:

```js
/* ---- shared kernel: interpolation + pose constructors (spec 2026-09-08) ---- */
const R = createRequire(import.meta.url)("../public/movement-languages/notation-render.js");

const twoKey = () => ({
  beats: 2,
  keys: [
    { beat: 0, pose: R.merge(R.standPose(), { rfarm: [0, 20] }) },
    { beat: 1, pose: R.merge(R.standPose(), { rfarm: [0, -60] }) },
  ],
});

test("poseAt returns each key's pose exactly at that key's beat", () => {
  const d = twoKey();
  assert.deepEqual(R.poseAt(d, 0).bones.rfarm.map(Math.round), [0, 20]);
  assert.deepEqual(R.poseAt(d, 1).bones.rfarm.map(Math.round), [0, -60]);
});

test("poseAt clamps outside the key range and does not extrapolate", () => {
  const d = twoKey();
  assert.deepEqual(R.poseAt(d, -5).bones.rfarm.map(Math.round), [0, 20]);
  assert.deepEqual(R.poseAt(d, 99).bones.rfarm.map(Math.round), [0, -60]);
});

test("poseAt interpolates between keys, staying strictly between the endpoints", () => {
  const el = R.poseAt(twoKey(), 0.5).bones.rfarm[1];
  assert.ok(el < 20 && el > -60, `midpoint elevation ${el} is not between the keys`);
});

test("poseAt yields unit-length bone directions (nlerp on the sphere, not an angle average)", () => {
  const p = R.poseAt(twoKey(), 0.5);
  for (const b of R.BONES) {
    const v = R.vec(...p.bones[b.id]);
    const m = Math.hypot(v.x, v.y, v.z);
    assert.ok(Math.abs(m - 1) < 1e-9, `${b.id} direction has length ${m}`);
  }
});

test("poseAt does not mutate the dancer it reads", () => {
  const d = twoKey();
  const before = JSON.stringify(d);
  R.poseAt(d, 0.5);
  assert.equal(JSON.stringify(d), before);
});

test("lerpAngle takes the short way around the wrap", () => {
  // Note: lerpAngle does NOT normalize its result — 350→10 midpoint is 360,
  // which is the same bearing as 0. Normalize before comparing.
  const norm = (a) => ((a % 360) + 360) % 360;
  assert.equal(Math.round(norm(R.lerpAngle(350, 10, 0.5))), 0);
  assert.equal(Math.round(norm(R.lerpAngle(10, 350, 0.5))), 0);
  // The short way, not the long way: 170→190 passes through 180, not through 0.
  assert.equal(Math.round(R.lerpAngle(170, 190, 0.5)), 180);
});

test("smooth is a smoothstep pinned at 0, 0.5 and 1", () => {
  assert.equal(R.smooth(0), 0);
  assert.equal(R.smooth(1), 1);
  assert.equal(R.smooth(0.5), 0.5);
});

test("nlerp returns a unit vector", () => {
  const v = R.nlerp({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.5);
  assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-12);
});

test("mkPose({}) equals standPose() and leaves STAND untouched", () => {
  assert.deepEqual(R.mkPose({}), R.standPose());
  const snapshot = JSON.stringify(R.standPose());
  R.mkPose({ hipY: 0.5, bones: { torso: [1, 2] } });
  assert.equal(JSON.stringify(R.standPose()), snapshot);
});

test("mkPose applies hipY and bone overrides", () => {
  const p = R.mkPose({ hipY: 0.74, bones: { rthigh: [58, -48] } });
  assert.equal(p.hipY, 0.74);
  assert.deepEqual(p.bones.rthigh, [58, -48]);
  assert.deepEqual(p.bones.head, R.standPose().bones.head);
});

test("labanToVec inverts labanOf for the cardinal directions", () => {
  for (const dir of ["forward", "right", "back", "left"]) {
    for (const level of ["low", "middle", "high"]) {
      const q = { dir, level, pin: 0 };
      const round = R.labanOf(R.labanToVec(q));
      assert.equal(round.dir, dir, `${dir}/${level} round-tripped to ${round.dir}`);
      assert.equal(round.level, level, `${dir}/${level} round-tripped to ${round.level}`);
    }
  }
});

test("labanToVec maps place-high and place-low to the poles", () => {
  assert.deepEqual(R.labanToVec({ dir: "place", level: "high" }), { x: 0, y: 1, z: 0 });
  assert.deepEqual(R.labanToVec({ dir: "place", level: "low" }), { x: 0, y: -1, z: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `TypeError: R.poseAt is not a function` (and similar for `mkPose`, `labanToVec`, `smooth`, `nlerp`, `lerpAngle`).

> **Line numbers in this task are as-of-task-start and DRIFT as you insert.**
> Each insertion shifts everything below it — by Step 7 the drift is 36 lines.
> **Anchor on the quoted content, never on the number.** The numbers below are
> orientation only.

- [ ] **Step 3: Add the interpolation primitives to `notation-render.js`**

In `public/movement-languages/notation-render.js`, in the math block, immediately after the `function rotY(...)` line and before the `function dirToAzEl(...)` line (≈14–15 at task start), insert — copied verbatim from `danceforms.html:578-582`:

```js
  function nlerp(a,b,u){ const x=a.x+(b.x-a.x)*u, y=a.y+(b.y-a.y)*u, z=a.z+(b.z-a.z)*u;
    const m=Math.hypot(x,y,z)||1; return {x:x/m,y:y/m,z:z/m}; }
  function lerp(a,b,u){ return a+(b-a)*u; }
  function lerpAngle(a,b,u){ let d=((b-a)%360+540)%360-180; return a+d*u; }
  function smooth(u){ return u*u*(3-2*u); }
```

- [ ] **Step 4: Add `mkPose` next to the existing pose constructors**

Immediately after the existing `function merge(pose, boneOverrides){...}` line (≈44 at task start; ≈48 after Step 3), insert — verbatim from `danceforms.html:499-504`:

```js
  function mkPose(over){
    const p = clonePose(STAND);
    if(over.hipY!==undefined) p.hipY=over.hipY;
    if(over.bones) for(const k in over.bones) p.bones[k]=over.bones[k].slice();
    return p;
  }
```

- [ ] **Step 5: Add `poseAt` before `skeleton`**

Immediately before `function skeleton(p){` (≈47 at task start; ≈57 after Steps 3–4), insert — verbatim from `danceforms.html:585-604`:

```js
  /* pose at time t for a dancer (interpolated, full pose incl. x/z/facing) */
  function poseAt(d, t){
    const ks = d.keys;
    if(!ks.length) return clonePose(STAND);
    if(t<=ks[0].beat) return clonePose(ks[0].pose);
    if(t>=ks[ks.length-1].beat) return clonePose(ks[ks.length-1].pose);
    let i=0; while(i<ks.length-1 && ks[i+1].beat<=t) i++;
    const A=ks[i], B=ks[i+1];
    const u = smooth((t-A.beat)/Math.max(1e-6, B.beat-A.beat));
    const p = clonePose(A.pose);
    p.hipY = lerp(A.pose.hipY, B.pose.hipY, u);
    p.x = lerp(A.pose.x, B.pose.x, u);
    p.z = lerp(A.pose.z, B.pose.z, u);
    p.facing = lerpAngle(A.pose.facing, B.pose.facing, u);
    for(const b of BONES){
      const va = vec(...A.pose.bones[b.id]), vb = vec(...B.pose.bones[b.id]);
      p.bones[b.id] = dirToAzEl(nlerp(va,vb,u));
    }
    return p;
  }
```

- [ ] **Step 6: Add `labanToVec` next to `labanOf`**

Immediately after the closing brace of `function labanOf(v){...}` and before `function hatchDef(id){`, insert — verbatim from `danceforms.html:929-933`:

```js
  function labanToVec(q){
    if(q.dir==="place") return q.level==="high"? {x:0,y:1,z:0}: {x:0,y:-1,z:0};
    const el={low:-45,middle:0,high:45}[q.level] + (q.pin||0)*22.5;
    return vec(DIR16.indexOf(q.dir)*22.5, el);
  }
```

- [ ] **Step 7: Export the seven new symbols**

Replace the module's single `return { ... };` statement — the last statement before the closing `});`, near the end of the file — with:

```js
  return { BONES, BONE, LIMBSETS, standPose, clonePose, merge, mkPose, skeleton, poseAt,
           limbVec, setLimbVec, vec, rotY, dirToAzEl, nlerp, lerp, lerpAngle, smooth,
           labanToVec, renderLaban, renderBenesh, renderEW };
```

(Task 4 widens this further; this step only needs the new symbols reachable so the tests pass.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all suites green.

- [ ] **Step 9: Confirm Comparison is unaffected**

Run: `node scripts/e2e-comparison.mjs`
Expected: passes. Nothing Comparison uses changed — this is a guard against a typo in the module.

- [ ] **Step 10: Commit**

```bash
git add public/movement-languages/notation-render.js test/notation.test.mjs
git commit -m "kernel: move poseAt, mkPose, labanToVec and interpolation into notation-render"
```

---

### Task 4: Complete the kernel exports

`notation-render.js` defines several kernel symbols it never exports (`limbLen`, `D2R`, `labanOf`, `labanQuantAt`, `labanSymbol`, `hatchDef`, `DIR8`, `DIR16`, `DIR_ARROW`, `LABAN_COLS`, `beneshDepthOf`, `ewCoord`, `STAND`). Studio needs all of them. This test is the safety net for the whole refactor, because Studio itself is only covered by e2e.

**Files:**
- Modify: `public/movement-languages/notation-render.js` (the return statement)
- Test: `test/notation.test.mjs`

**Interfaces:**
- Consumes: everything defined in `notation-render.js`.
- Produces: all 30 kernel symbols exported. Task 5's preamble destructures exactly this list.

- [ ] **Step 1: Write the failing test**

Append to `test/notation.test.mjs`:

```js
/* The exact list Studio's destructuring preamble binds (danceforms.html).
   If this test fails, Studio will throw a ReferenceError at runtime — which
   only the e2e would otherwise catch. Keep in step with the preamble. */
const KERNEL_EXPORTS = [
  "BONES", "BONE", "STAND", "clonePose", "mkPose",
  "D2R", "vec", "rotY", "nlerp", "lerp", "lerpAngle", "smooth", "dirToAzEl", "poseAt", "skeleton",
  "LIMBSETS", "limbVec", "setLimbVec", "limbLen",
  "DIR8", "DIR16", "DIR_ARROW", "labanOf", "labanToVec", "hatchDef", "labanSymbol",
  "LABAN_COLS", "labanQuantAt",
  "beneshDepthOf", "ewCoord",
];

test("notation-render exports every symbol Studio's preamble binds", () => {
  const missing = KERNEL_EXPORTS.filter((k) => R[k] === undefined);
  assert.deepEqual(missing, [], "missing kernel exports: " + missing.join(", "));
});

test("the kernel export list has no duplicates", () => {
  assert.equal(new Set(KERNEL_EXPORTS).size, KERNEL_EXPORTS.length);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `missing kernel exports: STAND, D2R, limbLen, DIR8, DIR16, DIR_ARROW, labanOf, hatchDef, labanSymbol, LABAN_COLS, labanQuantAt, beneshDepthOf, ewCoord`.

- [ ] **Step 3: Widen the export list**

Replace the return statement in `notation-render.js` with:

```js
  return {
    // pose model
    BONES, BONE, STAND, clonePose, standPose, merge, mkPose,
    // math + interpolation
    D2R, vec, rotY, nlerp, lerp, lerpAngle, smooth, dirToAzEl, poseAt, skeleton,
    // limbs
    LIMBSETS, limbVec, setLimbVec, limbLen,
    // Laban quantization + glyphs
    DIR8, DIR16, DIR_ARROW, labanOf, labanToVec, hatchDef, labanSymbol, LABAN_COLS, labanQuantAt,
    // Benesh / EWMN readings
    beneshDepthOf, ewCoord,
    // Comparison-only helpers (NOT part of the Studio kernel)
    SEG_TO_LABANCOL, segToLabanCol,
    // renderers (deliberately duplicated in danceforms.html — see spec)
    renderLaban, renderBenesh, renderEW,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/movement-languages/notation-render.js test/notation.test.mjs
git commit -m "kernel: export the full symbol set with a completeness test"
```

---

### Task 5: Wire Studio to the kernel and delete its copies

The one risky task. Everything before it exists to make this safe.

**Files:**
- Modify: `public/movement-languages/danceforms.html`

**Interfaces:**
- Consumes: all 30 exports from Task 4.
- Produces: a Studio with no kernel definitions of its own. Nothing later consumes this beyond Task 6's docs.

- [ ] **Step 1: Confirm a clean starting point**

```bash
cd /Users/galgo/Documents/movement-languages/vid2grid
git status --short          # expect: clean
npm test                    # expect: green
```

Then re-verify the line numbers this task depends on — if any line does not match, **stop**; the file has moved under the plan.

```bash
cd public/movement-languages
for n in 468 476 498 499 504 572 583 585 604 606 638 892 912 914 964 1037 1122 1125; do
  printf "%s: %s\n" "$n" "$(sed -n "${n}p" danceforms.html)"
done
```

Expected anchors: 468 `<script src="section-store.js"></script>`, 476 `const BONES = [`, 498 `function clonePose`, 499 `function mkPose(over){`, 504 `}`, 572 the math banner, 583 `function dirToAzEl`, 585 the `poseAt` comment, 604 `}`, 606 the skeleton comment, 638 `}`, 892 `const LIMBSETS = {`, 912 `function limbLen`, 914 the Laban banner, 964 `function labanQuantAt`, 1037 `function beneshDepthOf`, 1122 `function ewCoord(pose,segId){`, 1125 `}`.

- [ ] **Step 2: Add the script tag**

In `danceforms.html`, after line 468, insert:

```html
<script src="notation-render.js"></script>
```

`notation-render.js` is UMD and assigns `window.NotationRender`, so it **must** come before the inline `<script>` that follows. Both files are served from the same directory, so the relative `src` resolves.

- [ ] **Step 3: Delete the nine kernel blocks, highest line first**

Deleting in descending order keeps every remaining range valid. Line numbers below are the **original** ones; the script tag added in Step 2 shifts everything by +1, which is why this uses a single script anchored on content rather than raw offsets.

```bash
cd /Users/galgo/Documents/movement-languages/vid2grid/public/movement-languages
cp danceforms.html /tmp/danceforms.before.html
python3 - <<'PY'
L = open("danceforms.html").read().split("\n")
# +1 for the <script src="notation-render.js"> line inserted after 468.
blocks = [(1122,1125),(1037,1037),(914,964),(892,912),(606,638),(585,604),(572,583),(499,504),(476,498)]
for a, b in blocks:                      # descending; shift for the added tag
    del L[a:b+1]                          # a-1+1 .. b-1+1  →  a .. b
open("danceforms.html","w").write("\n".join(L))
print("removed", sum(b-a+1 for a,b in blocks), "lines")
PY
```

Expected: `removed 171 lines`.

- [ ] **Step 4: Add the destructuring preamble**

Find `"use strict";` near the top of the inline script (it was line 471, now 472). Immediately after it, insert:

```js
  /* The shared pose kernel. Every symbol below is defined once, in
     notation-render.js, and rebound here so Studio's existing call sites are
     unchanged. Keep this list in step with KERNEL_EXPORTS in
     test/notation.test.mjs — see docs/superpowers/specs/2026-09-08-shared-kernel-design.md. */
  const { BONES, BONE, STAND, clonePose, mkPose,
          D2R, vec, rotY, nlerp, lerp, lerpAngle, smooth, dirToAzEl, poseAt, skeleton,
          LIMBSETS, limbVec, setLimbVec, limbLen,
          DIR8, DIR16, DIR_ARROW, labanOf, labanToVec, hatchDef, labanSymbol,
          LABAN_COLS, labanQuantAt,
          beneshDepthOf, ewCoord } = NotationRender;
```

- [ ] **Step 5: Verify no kernel symbol is still defined in Studio**

```bash
cd /Users/galgo/Documents/movement-languages/vid2grid/public/movement-languages
grep -nE '^\s*(const|function)\s+(BONES|BONE|STAND|clonePose|mkPose|D2R|vec|rotY|nlerp|lerp|lerpAngle|smooth|dirToAzEl|poseAt|skeleton|LIMBSETS|limbVec|setLimbVec|limbLen|DIR8|DIR16|DIR_ARROW|labanOf|labanToVec|hatchDef|labanSymbol|LABAN_COLS|labanQuantAt|beneshDepthOf|ewCoord)\b' danceforms.html
```

Expected: **no output.** Any hit is a block that did not delete cleanly.

- [ ] **Step 6: Verify the notation views are byte-identical**

```bash
cd /Users/galgo/Documents/movement-languages/vid2grid
WS=/Users/galgo/Documents/movement-languages/vid2grid/.superpowers/sdd/2026-09-08-shared-kernel
node "$WS/baseline-studio-svg.mjs" "$WS/baseline-after.json"
diff "$WS/baseline-before.json" "$WS/baseline-after.json" && echo "IDENTICAL"
```

Expected: `IDENTICAL`. **Any diff is a bug in the refactor, not an improvement** — the kernel was copied verbatim, so the output must match exactly. Investigate before continuing.

- [ ] **Step 7: Run the full test and e2e suites**

```bash
npm test
npm run e2e
```

Expected: both green, including `e2e-studio: OK`. If Studio throws `X is not defined`, `X` is missing from either the preamble (Step 4) or the exports (Task 4 Step 3) — add it to both, and to `KERNEL_EXPORTS` in the test.

- [ ] **Step 8: Confirm the line reduction**

```bash
git diff --stat public/movement-languages/danceforms.html
```

Expected: roughly 171 deletions against ~11 insertions (one `<script>` tag, four comment lines, six preamble lines).

- [ ] **Step 9: Commit**

```bash
git add public/movement-languages/danceforms.html
git commit -m "studio: load the shared kernel and drop 171 lines of duplicated definitions"
```

---

### Task 6: Update the documentation

**Files:**
- Modify: `public/movement-languages/notation-render.js` (header comment)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the finished refactor.
- Produces: nothing code-level.

- [ ] **Step 1: Invert the source-of-truth claim in the module header**

The current header says `SOURCE OF TRUTH: danceforms.html` and `Keep in step with danceforms.html by hand until it is unfrozen`. Both are now false for the kernel. Replace the header comment with:

```js
/* notation-render.js — the shared pose kernel for the movement-languages pages,
   plus React-free copies of the three notation renderers.

   KERNEL (pose model, FK, limb helpers, interpolation, Laban quantization):
   defined HERE and nowhere else. danceforms.html loads this module and rebinds
   these symbols via a destructuring preamble; comparison.html uses them
   directly. test/notation.test.mjs pins the export list.

   RENDERERS (renderLaban / renderBenesh / renderEW): deliberately duplicated —
   danceforms.html keeps its own selection-and-tools versions, and remains the
   source of truth for their layout. Ported verbatim; only DOM/selection
   coupling is removed. Keep those three in step by hand.

   See docs/superpowers/specs/2026-09-08-shared-kernel-design.md. */
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the bullet that begins "Sections/choreography:", the sentence describing the static pages says the pages can't import from the app and that `danceforms.html` is frozen. Replace the frozen claim with the new arrangement. Add this sentence after the `section-store.js` sentence:

```
`public/movement-languages/notation-render.js` is the shared pose kernel — bone
model, `skeleton()` FK, limb helpers, `poseAt()` interpolation and the Laban
quantizer live there once; `danceforms.html` loads it and rebinds them in a
destructuring preamble, and `comparison.html` calls them directly. Add a kernel
symbol in both the module's export list and `KERNEL_EXPORTS` in
`test/notation.test.mjs`. The three notation *renderers* stay duplicated on
purpose (Studio's carry selection and editing tools); `danceforms.html` is no
longer frozen.
```

- [ ] **Step 3: Verify nothing broke**

```bash
npm test && npm run e2e
```

Expected: green. (Docs-only, but cheap insurance.)

- [ ] **Step 4: Commit**

```bash
git add public/movement-languages/notation-render.js CLAUDE.md
git commit -m "docs: notation-render is the shared kernel; unfreeze danceforms"
```

- [ ] **Step 5: Clean up scratch files**

```bash
WS=/Users/galgo/Documents/movement-languages/vid2grid/.superpowers/sdd/2026-09-08-shared-kernel
rm -f "$WS/baseline-before.json" "$WS/baseline-after.json" "$WS/baseline-studio-svg.mjs" /tmp/danceforms.before.html
```

---

## Acceptance (from the spec)

Verify all seven before calling this done:

1. `danceforms.html` defines no kernel symbol; all nine blocks (171 lines) gone — Task 5 Steps 5 and 8.
2. `notation-render.js` exports all 30; `poseAt`, `mkPose`, `labanToVec` and the interpolation primitives live only there — Task 4.
3. `npm test` green — Task 5 Step 7.
4. `npm run e2e` green including `e2e-studio.mjs` — Task 5 Step 7.
5. The three notation views render byte-identically to the baseline — Task 5 Step 6.
6. Comparison's behaviour unchanged — `e2e-comparison.mjs`, Task 3 Step 9 and Task 5 Step 7.
7. `CLAUDE.md` updated, `danceforms.html` no longer described as frozen — Task 6.
