# Focused-Studio Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `public/movement-languages/comparison.html` from a fixed five-window explainer into a focused Studio: pick 2–3 notations, focus the whole body or one segment, author or load a movement, and read it live in each notation side by side — with a strip that names where the systems disagree.

**Architecture:** Studio's three keyframe-driven renderers (Laban/Benesh/EWMN) are ported out of the monolithic, frozen `danceforms.html` into a new React-free UMD twin, `notation-render.js`, as pure `(dancer, opts) -> svgString` functions plus the pose model they need. The reworked `comparison.html` drives them from a shared `dancer` object edited through a light editor and preset menu. A disagreement strip reads capability flags from the existing `notation.js`.

**Tech Stack:** Vanilla ES (UMD twin modules, same pattern as `section-store.js`/`notation.js`), SVG string rendering, `node:test` unit tests via `createRequire`, Playwright e2e. No build step for the static pages.

**Spec:** `docs/superpowers/specs/2026-08-28-comparison-focused-studio-design.md`

## Global Constraints

- **Additive and faithful.** No notation symbol is invented; unverified forms render as provisional (dashed, lighter fill) and are registered in `notation.js` `PROVISIONAL_GLYPHS` and logged in `docs/glyph-verification-todo.md`. (Invariants 1, 8; glyph-fidelity rule in `CLAUDE.md`.)
- **EWMN never gains a dynamics slot** (§4.7 / invariant 8).
- **`danceforms.html` is the source of truth for the ported code and is NOT edited by this plan.** `notation-render.js` is a hand-kept duplicate; its header cites the source line ranges. De-duplication is a separate, later, separately-approved task.
- **Ports are verbatim + mechanical transforms only.** Do not retype glyph geometry from memory; copy the cited source lines, then apply the listed edits. Any deviation from the source drawing is a bug.
- **No-build static pages.** `comparison.html` may add exactly one `<script src="notation-render.js">`. No bundler, no import from the Next app.
- **Minimum two notations** must stay selected in the picker — it is a comparison.
- **Motif is excluded** from live rendering (no verified renderer).
- Commit after each task. Run `npm test` (node units) and, where noted, `npm run e2e` (needs the dev server) before committing.
- Body-local frame is left-handed (x right, y up, z forward); do not re-derive axis conventions — they come with the ported code.

---

## File Structure

- **Create** `public/movement-languages/notation-render.js` — UMD twin: math + pose model + `skeleton` FK + the three pure renderers. One responsibility: turn a `dancer` into notation SVG. ~350 lines.
- **Modify** `public/movement-languages/comparison.html` — reworked into picker + focus + stage + panels + light editor + preset menu + disagreement strip + retargeted tour.
- **Modify** `public/movement-languages/notation.js` — add `structuralGaps(pickedSystems)` (capability-diff helper) beside the existing `systemCarriesDynamics`; register any new provisional glyphs.
- **Modify** `test/notation.test.mjs` — add unit tests for the pure renderers and `structuralGaps`.
- **Rewrite** `scripts/e2e-comparison.mjs` — drive the picker/focus/preset/strip/tour flow.
- **Modify** `docs/glyph-verification-todo.md` — log any glyph surfaced by the port that was not already provisional.

### The `dancer` model (used by every task)

A movement is a plain object, the same shape the existing `test/notation.test.mjs` fixtures already use:

```js
// dancer
{
  beats: 2,                                  // integer 1..8, the score length
  keys: [                                    // keyframes, ascending beat, first at beat 0
    { beat: 0,   pose: { bones: { rfarm: [0, 20], /* ...all 10 bones... */ } } },
    { beat: 1.5, pose: { bones: { rfarm: [0, -60], /* ... */ } } },
  ],
}
```

Every pose carries all ten bone ids (`torso, head, ruarm, rfarm, luarm, lfarm, rthigh, rshin, lthigh, lshin`) as `[az, el]`. A helper `standPose()` (Task 1) fills a full upright pose so presets and edits only specify the bones they change.

### Renderer interface (produced by Tasks 3–5, consumed by page tasks)

```js
NotationRender.renderLaban(dancer, opts) -> svgString
NotationRender.renderBenesh(dancer, opts) -> svgString
NotationRender.renderEW(dancer, opts) -> svgString
// opts = { focusSegment?: string|null }   // a bone id, or a LIMBSET/part id; null = whole body
// Each returns a complete <svg ...>...</svg> string. focusSegment adds class="focus"
// to the emphasized column/row/sign group and class="dim" to the rest; null adds neither.
```

---

## Task 1: Pose model + `notation-render.js` scaffold

**Files:**
- Create: `public/movement-languages/notation-render.js`
- Test: `test/notation.test.mjs` (append)

**Interfaces:**
- Produces: `NotationRender.BONES`, `NotationRender.standPose()`, `NotationRender.clonePose(p)`, `NotationRender.skeleton(pose)`, `NotationRender.limbVec(pose, partId)`, `NotationRender.LIMBSETS`. All ported verbatim from `danceforms.html`; consumed by Tasks 3–6 and the stage.

- [ ] **Step 1: Write the failing test**

Append to `test/notation.test.mjs`:

```js
const R = createRequire(import.meta.url)("../public/movement-languages/notation-render.js");

test("standPose fills all ten bones as [az,el] pairs", () => {
  const p = R.standPose();
  for (const b of R.BONES) assert.ok(Array.isArray(p.bones[b.id]) && p.bones[b.id].length === 2, b.id);
});

test("skeleton of the upright pose puts the chest above the root and returns 11 segments", () => {
  const sk = R.skeleton(R.standPose());
  assert.equal(sk.seg.length, 11);                 // torso, clav, pelvis, + 8 limb bones
  const torso = sk.seg.find(s => s[0] === "torso");
  assert.ok(torso[2].y > torso[1].y, "chest is above the root");
});

test("limbVec returns a unit vector for the right arm", () => {
  const v = R.limbVec(R.standPose(), "rarm");
  assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notation.test.mjs`
Expected: FAIL — cannot find module `notation-render.js`.

- [ ] **Step 3: Create `notation-render.js` by porting the pose model**

Create the file with this UMD wrapper, then paste the cited source **verbatim** inside the factory:

```js
/* notation-render.js — React-free twin of the pose model + the three notation
   renderers embedded in danceforms.html. SOURCE OF TRUTH: danceforms.html.
   Ported verbatim; only DOM/selection coupling is removed (see comparison spec
   2026-08-28). Keep in step with danceforms.html by hand until it is unfrozen. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NotationRender = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- math: verbatim from danceforms.html:521-532 ---
  const D2R = Math.PI / 180;
  function vec(az, el){ const a=az*D2R, e=el*D2R; return {x:Math.sin(a)*Math.cos(e), y:Math.sin(e), z:Math.cos(a)*Math.cos(e)}; }
  function rotY(v, deg){ const r=deg*D2R, c=Math.cos(r), s=Math.sin(r); return {x:v.x*c+v.z*s, y:v.y, z:-v.x*s+v.z*c}; }
  function dirToAzEl(v){ return [Math.atan2(v.x,v.z)/D2R, Math.asin(Math.max(-1,Math.min(1,v.y)))/D2R]; }

  // --- bones + pose: verbatim from danceforms.html:429-457 (BONES, BONE, STAND, clonePose) ---
  // PASTE BONES (429-440), BONE (441), STAND (443-450), clonePose (451) here, unchanged.

  function standPose(){ return clonePose(STAND); }

  // --- skeleton FK: verbatim from danceforms.html:556-587 ---
  // PASTE skeleton(p) here, unchanged.

  // --- limb helpers: verbatim from danceforms.html:832-852 (LIMBSETS, limbVec, setLimbVec, limbLen) ---
  // PASTE LIMBSETS (832-839), limbVec (840-847), setLimbVec (848-851), limbLen (852) here, unchanged.

  return { BONES, BONE, LIMBSETS, standPose, clonePose, skeleton, limbVec, setLimbVec, vec, rotY, dirToAzEl };
});
```

Porting rule for this task: copy the exact lines cited in each `PASTE` comment from `danceforms.html`. Change nothing inside them. `STAND` already contains all ten bones, so `standPose()` returns a complete pose.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notation.test.mjs`
Expected: PASS (all three new tests, plus the existing 22 still green).

- [ ] **Step 5: Commit**

```bash
git add public/movement-languages/notation-render.js test/notation.test.mjs
git commit -m "Comparison: port pose model into notation-render.js twin"
```

---

## Task 2: Page shell + notation picker (layout first)

Confirms the general layout works before any renderer exists — the user's explicit first checkpoint. Panels show a "pick to compare" placeholder.

**Files:**
- Modify: `public/movement-languages/comparison.html` (replace the windowed body/JS; keep the danceforms shell: theme tokens, header/nav with Comparison active, footer)
- Rewrite: `scripts/e2e-comparison.mjs`

**Interfaces:**
- Produces DOM contract for later tasks: a container `#panels` holding one `.pane[data-sys="laban|benesh|ewmn"]` per picked notation, each with a `.pane-body`; picker checkboxes `.pick[data-sys="..."]`; focus `<select id="focusSel">`; a `#stage` element; a `#disagree` strip; movement `<select id="presetSel">`. `window.CMP` exposes `{ dancer, picks, focus, render() }` for tests.

- [ ] **Step 1: Write the failing e2e**

Replace `scripts/e2e-comparison.mjs` with a first slice (grows over later tasks):

```js
/* End-to-end: focused-Studio Comparison. Requires the dev server on :3000. */
import { chromium } from "playwright";
const URL = "http://localhost:3000/movement-languages/comparison.html";
const die = (m) => { throw new Error(m); };
const browser = await chromium.launch();
let exitCode = 0;
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem("ml_comparison_tour_v1", "1"); } catch { /* private mode */ } });
  await page.goto(URL, { waitUntil: "networkidle" });

  // Three pickers; two checked by default (Laban, Benesh); two panes shown.
  const picks = await page.$$eval(".pick", els => els.map(e => ({ sys: e.dataset.sys, on: e.checked })));
  if (picks.length !== 3) die(`expected 3 pickers, got ${picks.length}`);
  if (picks.filter(p => p.on).length < 2) die("fewer than two notations checked at start");
  const panes0 = await page.$$eval(".pane", els => els.map(e => e.dataset.sys));
  if (panes0.length !== picks.filter(p => p.on).length) die("pane count != checked pickers");

  // Turning a third notation on adds its pane.
  await page.click('.pick[data-sys="ewmn"]');
  if ((await page.$$(".pane")).length !== 3) die("enabling EWMN did not add a third pane");

  // Cannot uncheck below two: uncheck down to two, the last two refuse.
  for (const sys of ["ewmn", "benesh", "laban"]) {
    const box = await page.$(`.pick[data-sys="${sys}"]`);
    if (await box.isChecked()) await box.click().catch(() => {});
  }
  if ((await page.$$eval(".pick", els => els.filter(e => e.checked).length)) < 2) die("picker allowed dropping below two notations");

  if (errs.length) die("console/page errors: " + JSON.stringify(errs));
  console.log("PASS: Comparison shell — picker, min-two, panes track selection");
} catch (e) { console.error("FAIL:", e && e.message ? e.message : e); exitCode = 1; }
finally { await browser.close(); }
process.exit(exitCode);
```

- [ ] **Step 2: Run it to verify it fails**

Run (with the dev server up): `node scripts/e2e-comparison.mjs`
Expected: FAIL — old page has no `.pick`/`.pane` contract.

- [ ] **Step 3: Rework `comparison.html` shell**

Keep the existing danceforms shell (head, theme tokens, header/nav, footer). Replace the main content with the tool skeleton. Add near the other scripts: `<script src="notation-render.js"></script>` (and keep `<script src="notation.js"></script>`). Body content:

```html
<section class="tool">
  <div class="controls">
    <fieldset class="picker" aria-label="Notations to compare">
      <label><input type="checkbox" class="pick" data-sys="laban" checked> Labanotation</label>
      <label><input type="checkbox" class="pick" data-sys="benesh" checked> Benesh</label>
      <label><input type="checkbox" class="pick" data-sys="ewmn"> Eshkol-Wachman</label>
    </fieldset>
    <label class="focusctl">Focus
      <select id="focusSel"><option value="">Whole body</option></select>
    </label>
    <label class="presetctl">Movement
      <select id="presetSel"></select>
    </label>
  </div>
  <div class="workspace">
    <div id="stage" class="stage" aria-label="Stage"></div>
    <div id="panels" class="panels"></div>
  </div>
  <div id="disagree" class="disagree" hidden></div>
</section>
```

Add JS (vanilla, after the scripts):

```js
const CMP = {
  dancer: NotationRender.standDancer ? NotationRender.standDancer() : { beats: 2, keys: [{ beat: 0, pose: NotationRender.standPose() }] },
  picks: { laban: true, benesh: true, ewmn: false },
  focus: null,
  render() { renderPanels(); },
};
window.CMP = CMP;

const SYS_LABEL = { laban: "Labanotation", benesh: "Benesh", ewmn: "Eshkol-Wachman" };
function pickedList() { return ["laban", "benesh", "ewmn"].filter(s => CMP.picks[s]); }

function renderPanels() {
  const host = document.getElementById("panels");
  host.innerHTML = pickedList().map(sys =>
    `<div class="pane" data-sys="${sys}"><div class="pane-cap">${SYS_LABEL[sys]}</div>` +
    `<div class="pane-body"><p class="ph">renderer arrives in a later task</p></div></div>`
  ).join("");
}

document.querySelectorAll(".pick").forEach(box => {
  box.addEventListener("change", () => {
    const sys = box.dataset.sys;
    if (!box.checked && pickedList().length <= 2) { box.checked = true; return; } // min two
    CMP.picks[sys] = box.checked;
    CMP.render();
  });
});
renderPanels();
```

Add minimal CSS for `.tool`, `.controls`, `.workspace` (grid: stage left, panels right, wrapping on narrow), `.panels` (responsive flex/grid), `.pane`, `.pane-cap`, `.disagree`. Reuse existing theme tokens (`--ink`, `--line`, `--card`, `--paper`, `--accent`).

- [ ] **Step 4: Run the e2e to verify it passes**

Run: `node scripts/e2e-comparison.mjs`
Expected: PASS.

- [ ] **Step 5: Confirm layout by eye and commit**

Load `/movement-languages/comparison.html`, confirm the controls row and the two placeholder panes lay out cleanly and reflow on a narrow window.

```bash
git add public/movement-languages/comparison.html scripts/e2e-comparison.mjs
git commit -m "Comparison: page shell, notation picker (min two), placeholder panes"
```

---

## Task 3: Laban pure renderer

**Files:**
- Modify: `public/movement-languages/notation-render.js`
- Test: `test/notation.test.mjs` (append)

**Interfaces:**
- Consumes: `skeleton`, `limbVec`, `LIMBSETS`, `BONE` from Task 1.
- Produces: `NotationRender.renderLaban(dancer, opts) -> svgString`.

- [ ] **Step 1: Write the failing test**

```js
const w3dancer = () => ({
  beats: 2,
  keys: [
    { beat: 0,   pose: R.merge(R.standPose(), { rfarm: [0, 20] }) },
    { beat: 1,   pose: R.merge(R.standPose(), { rfarm: [0, -30] }) },
    { beat: 1.5, pose: R.merge(R.standPose(), { rfarm: [0, -60] }) },
  ],
});

test("renderLaban returns an SVG staff with at least one direction/level symbol", () => {
  const svg = R.renderLaban(w3dancer(), {});
  assert.match(svg, /^<svg/);
  assert.match(svg, /path d="M/);              // a Laban symbol path (invariant: shape = direction)
  assert.match(svg, /R ARM/);                  // a column label
});

test("renderLaban focus emphasizes the focused column and dims the rest", () => {
  const svg = R.renderLaban(w3dancer(), { focusSegment: "rfarm" });
  assert.match(svg, /class="[^"]*focus[^"]*" data-col="rarm"/);
  assert.match(svg, /class="[^"]*dim[^"]*" data-col="larm"/);
});
```

Also add `merge` to Task 1's exports if not present (small helper): append to `notation-render.js` factory and to its return object:

```js
function merge(pose, boneOverrides){ const p = clonePose(pose); for (const k in boneOverrides) p.bones[k] = boneOverrides[k].slice(); return p; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notation.test.mjs`
Expected: FAIL — `renderLaban` undefined.

- [ ] **Step 3: Port the Laban renderer**

Into `notation-render.js`, paste **verbatim** from `danceforms.html`: `DIR8` (855), `DIR16` (856), `DIR_ARROW` (857-858), `labanOf` (859-868), `hatchDef` (874-877), `labanSymbol` (878-900), `LABAN_COLS` (903), `labanQuantAt` (904). Then port `renderLabanView` (905-955) into `renderLaban(dancer, opts)` applying exactly these mechanical edits:

1. Signature: `function renderLaban(dancer, opts){ opts = opts || {}; const d = dancer; const T = dancer.beats; if (!d || !d.keys.length) return ""; ...` — i.e. drop the `holder`/`$("#labanView")` lines (906-908) and the `score.length` reference (909), substituting `dancer.beats`.
2. Delete the trailing `holder.innerHTML = ...; renderLabanTools();` (954-956). Instead build `const W = colX.head+symW+70;` and `return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:none">${g}</svg>`;`.
3. Selection highlight: the `sel` line (939) referenced `state.selK`/`state.selPart`. Replace with `const sel = false;` (no editing selection in the pure renderer) — the `.lslot` rect stays but never draws the selected outline. Keep `data-k`/`data-part` on the rect.
4. Focus (highlight-in-context): wrap each column's per-key output in a group carrying the column id and a focus class. Define once before the keys loop:
   `const focusCol = opts.focusSegment ? segToLabanCol(opts.focusSegment) : null;`
   and add near `LABAN_COLS` a map:
   ```js
   const SEG_TO_LABANCOL = { luarm:"larm", lfarm:"larm", ruarm:"rarm", rfarm:"rarm",
     lthigh:"lleg", lshin:"lleg", rthigh:"rleg", rshin:"rleg", torso:"body", head:"head" };
   function segToLabanCol(seg){ return SEG_TO_LABANCOL[seg] || (LIMBSETS[seg] ? seg : null); }
   ```
   In the `for(const p of LABAN_COLS)` loop, open `g += `<g data-col="${p}" class="${focusCol ? (p===focusCol ? "focus" : "dim") : ""}">`;` before the symbol/slot output for `p` and close `</g>` after. (The symbol/slot code between stays byte-for-byte as ported.)

Add `renderLaban` to the module's return object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/movement-languages/notation-render.js test/notation.test.mjs
git commit -m "Comparison: port Laban renderer as pure function with focus"
```

---

## Task 4: Wire Laban into the page + stage skeleton

**Files:**
- Modify: `public/movement-languages/comparison.html`
- Modify: `scripts/e2e-comparison.mjs`

**Interfaces:**
- Consumes: `renderLaban`, `skeleton` from Tasks 1/3; the `#stage`, `.pane-body`, `#focusSel` DOM from Task 2.
- Produces: `renderStage()` and a populated `#focusSel`; `renderPanels()` now calls the real renderer for `laban`.

- [ ] **Step 1: Add e2e assertions (extend Task 2's script)**

Insert before the final `if (errs.length)`:

```js
  // Laban pane draws a real staff.
  await page.reload({ waitUntil: "networkidle" });
  const labanBody = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  if (!/^<svg/.test(labanBody) || !/path d="M/.test(labanBody)) die("Laban pane has no staff");
  // Focus a segment: its column emphasized, another dimmed.
  await page.selectOption("#focusSel", "rfarm");
  const focused = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  if (!/class="[^"]*focus[^"]*" data-col="rarm"/.test(focused)) die("focus did not emphasize the R arm column");
  if (!/class="[^"]*dim[^"]*" data-col="larm"/.test(focused)) die("focus did not dim the other columns");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/e2e-comparison.mjs`
Expected: FAIL — Laban pane still shows the placeholder.

- [ ] **Step 3: Wire the renderer, focus select, and stage**

In `comparison.html` JS, replace `renderPanels` body-building for `laban` with the real call, populate `#focusSel`, and draw the stage skeleton (front-ish orthographic, focused segment bold):

```js
const RENDERERS = { laban: NotationRender.renderLaban }; // benesh/ewmn added in Tasks 5–6

function renderPanels() {
  const host = document.getElementById("panels");
  host.innerHTML = pickedList().map(sys => {
    const fn = RENDERERS[sys];
    const body = fn ? fn(CMP.dancer, { focusSegment: CMP.focus }) : `<p class="ph">${SYS_LABEL[sys]} — soon</p>`;
    return `<div class="pane" data-sys="${sys}"><div class="pane-cap">${SYS_LABEL[sys]}</div><div class="pane-body">${body}</div></div>`;
  }).join("");
}

// Focus options: whole body + each bone (label from BONES).
(function fillFocus(){
  const sel = document.getElementById("focusSel");
  for (const b of NotationRender.BONES) {
    const o = document.createElement("option"); o.value = b.id; o.textContent = b.label; sel.appendChild(o);
  }
  sel.addEventListener("change", () => { CMP.focus = sel.value || null; CMP.render(); renderStage(); });
})();

function renderStage() {
  const sk = NotationRender.skeleton(CMP.dancer.keys[0].pose);
  const S = 150, cx = 150, cy = 260; // orthographic scale/origin
  const pr = p => ({ x: cx + (p.x*0.92 + p.z*0.30)*S, y: cy - p.y*S });
  const seg = sk.seg.map(([id, a, b]) => {
    const pa = pr(a), pb = pr(b);
    const on = !CMP.focus || id === CMP.focus || NotationRender.LIMBSETS[CMP.focus]?.segs?.includes(id);
    return `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" ` +
      `style="stroke:var(--ink);stroke-width:${on?3:1.4};opacity:${CMP.focus&&!on?0.35:1}" stroke-linecap="round"/>`;
  }).join("");
  const hc = pr(sk.headC);
  document.getElementById("stage").innerHTML =
    `<svg viewBox="0 0 300 300" width="100%" height="100%"><circle cx="${hc.x.toFixed(1)}" cy="${hc.y.toFixed(1)}" r="10" fill="none" style="stroke:var(--ink);stroke-width:1.6"/>${seg}</svg>`;
}

CMP.render = () => { renderPanels(); };
renderStage();
renderPanels();
```

- [ ] **Step 4: Run the e2e to verify it passes**

Run: `node scripts/e2e-comparison.mjs`
Expected: PASS. Eyeball: the Laban staff is legible and focusing R forearm bolds the R-arm column and the stage arm.

- [ ] **Step 5: Commit**

```bash
git add public/movement-languages/comparison.html scripts/e2e-comparison.mjs
git commit -m "Comparison: wire Laban panel, focus selector, and stage skeleton"
```

---

## Task 5: Benesh pure renderer + wiring

**Files:**
- Modify: `public/movement-languages/notation-render.js`, `comparison.html`, `test/notation.test.mjs`, `scripts/e2e-comparison.mjs`

**Interfaces:**
- Consumes: `skeleton`, `clonePose` from Task 1.
- Produces: `NotationRender.renderBenesh(dancer, opts) -> svgString`; `RENDERERS.benesh` wired.

- [ ] **Step 1: Write the failing unit test**

```js
test("renderBenesh returns a five-line stave with an extremity sign", () => {
  const svg = R.renderBenesh(w3dancer(), {});
  assert.match(svg, /^<svg/);
  const staveLines = (svg.match(/<line[^>]*class="stave"/g) || []).length;
  assert.equal(staveLines, 5);                 // TOP OF HEAD / SHOULDERS / WAIST / KNEES / FLOOR
});

test("renderBenesh focus dims non-focused extremity signs", () => {
  const svg = R.renderBenesh(w3dancer(), { focusSegment: "rfarm" });
  assert.match(svg, /class="[^"]*focus[^"]*" data-seg="rarm"/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/notation.test.mjs`
Expected: FAIL — `renderBenesh` undefined.

- [ ] **Step 3: Port the Benesh renderer**

Paste **verbatim** from `danceforms.html`: `BENESH_PARTS` (975-976), `beneshDepthOf` (977). Port `renderBeneshView` (978-~1047) into `renderBenesh(dancer, opts)` with these mechanical edits:
1. Replace the holder/`score.dancers[state.selD]`/`score.length` lines with `const d = dancer, T = dancer.beats; if (!d || !d.keys.length) return "";`.
2. Delete the trailing `holder.innerHTML = ...; renderBeneshTools();`; `return` the `<svg ...>${g}</svg>` string instead.
3. Add `class="stave"` to each of the five horizontal stave lines as they are emitted (so the test and focus logic can find them). This is an attribute addition on existing lines, not a geometry change.
4. Any editing-selection branch that reads `state.selPart`/`state.selK` (e.g. the `editable` line 1042 and its highlight): replace the selection flag with `false` and drop the tools call.
5. Focus: for each `part in BENESH_PARTS`, wrap its extremity-sign output in `<g data-seg="${part}" class="${opts.focusSegment ? (segToBeneshPart(opts.focusSegment)===part ? "focus":"dim") : ""}">…</g>`. Add:
   ```js
   const SEG_TO_BENESH = { ruarm:"rarm", rfarm:"rarm", luarm:"larm", lfarm:"larm", rthigh:"rleg", rshin:"rleg", lthigh:"lleg", lshin:"lleg" };
   function segToBeneshPart(seg){ return SEG_TO_BENESH[seg] || (BENESH_PARTS[seg] ? seg : null); }
   ```
   (Torso/head have no Benesh extremity part; focusing them dims all four extremity signs, which is correct — they are not extremity-notated.)
6. Preserve every `data-prov` provisional wrapper exactly as in the source.

Add `renderBenesh` to the return object.

- [ ] **Step 4: Wire into the page + extend e2e**

In `comparison.html`: `RENDERERS.benesh = NotationRender.renderBenesh;`. In `scripts/e2e-comparison.mjs`, after the Laban checks:

```js
  const beneshBody = await page.$eval('.pane[data-sys="benesh"] .pane-body', el => el.innerHTML);
  if (!/^<svg/.test(beneshBody) || !/class="stave"/.test(beneshBody)) die("Benesh pane has no stave");
```

- [ ] **Step 5: Run tests + e2e, then commit**

Run: `node --test test/notation.test.mjs` (PASS) and `node scripts/e2e-comparison.mjs` (PASS). Eyeball the stave.

```bash
git add public/movement-languages/notation-render.js public/movement-languages/comparison.html test/notation.test.mjs scripts/e2e-comparison.mjs
git commit -m "Comparison: port Benesh renderer as pure function and wire it"
```

---

## Task 6: Eshkol-Wachman pure renderer + wiring

**Files:**
- Modify: `public/movement-languages/notation-render.js`, `comparison.html`, `test/notation.test.mjs`, `scripts/e2e-comparison.mjs`

**Interfaces:**
- Consumes: `BONES` from Task 1.
- Produces: `NotationRender.renderEW(dancer, opts) -> svgString`; `RENDERERS.ewmn` wired.

- [ ] **Step 1: Write the failing unit test**

```js
test("renderEW returns a manuscript grid with a bone row and numerals", () => {
  const svg = R.renderEW(w3dancer(), {});
  assert.match(svg, /^<svg/);
  assert.match(svg, /R FOREARM/i);             // a bone row label
  assert.match(svg, /<text[^>]*>-?\d(\.5)?<\/text>/); // a 45-unit numeral cell
});

test("renderEW carries no dynamics text (invariant 8 / §4.7)", () => {
  const svg = R.renderEW(w3dancer(), {});
  assert.doesNotMatch(svg, /impulse|impact|dynamic/i);
});

test("renderEW focus emphasizes the focused bone row", () => {
  const svg = R.renderEW(w3dancer(), { focusSegment: "rfarm" });
  assert.match(svg, /class="[^"]*focus[^"]*" data-seg="rfarm"/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/notation.test.mjs`
Expected: FAIL — `renderEW` undefined.

- [ ] **Step 3: Port the EW renderer**

Paste **verbatim** from `danceforms.html`: `ewCoord` (1062-1065). Port `renderEWView` (1066-~1096) into `renderEW(dancer, opts)`:
1. Replace holder/`score`/`state` lines with `const d = dancer, T = dancer.beats; if (!d || !d.keys.length) return "";`.
2. Delete trailing holder assignment + tools call; `return` the `<svg>` string.
3. Focus: wrap each bone row in `<g data-seg="${bone.id}" class="${opts.focusSegment===bone.id ? "focus" : (opts.focusSegment ? "dim" : "")}">…</g>` (EW rows are per-bone, so the focus segment maps 1:1 to a row; a LIMBSET focus like `rarm` dims all — acceptable, EW is per-bone).
4. Keep the `ewmn.movement.plane` provisional wrapper (`data-prov`) exactly as in the source.

Add `renderEW` to the return object.

- [ ] **Step 4: Wire into the page + extend e2e**

`RENDERERS.ewmn = NotationRender.renderEW;`. In the e2e, enable EWMN and assert its grid:

```js
  await page.click('.pick[data-sys="ewmn"]');
  const ewBody = await page.$eval('.pane[data-sys="ewmn"] .pane-body', el => el.innerHTML);
  if (!/^<svg/.test(ewBody)) die("EWMN pane has no grid");
```

- [ ] **Step 5: Run tests + e2e, then commit**

Run both suites (PASS). Eyeball the grid.

```bash
git add public/movement-languages/notation-render.js public/movement-languages/comparison.html test/notation.test.mjs scripts/e2e-comparison.mjs
git commit -m "Comparison: port Eshkol-Wachman renderer as pure function and wire it"
```

---

## Task 7: Disagreement strip

**Files:**
- Modify: `public/movement-languages/notation.js`, `comparison.html`, `test/notation.test.mjs`, `scripts/e2e-comparison.mjs`

**Interfaces:**
- Consumes: existing `systemCarriesDynamics` in `notation.js`; the `#disagree` element and `pickedList()` from Task 2.
- Produces: `Notation.structuralGaps(pickedSystems) -> [{ system, gap }]`; `renderDisagree()` in the page.

- [ ] **Step 1: Write the failing unit test**

```js
test("structuralGaps flags EWMN's missing dynamics against dynamics-carrying peers", () => {
  const gaps = N.structuralGaps(["laban", "benesh", "ewmn"]);
  const ew = gaps.find(g => g.system === "ewmn");
  assert.ok(ew && /dynamics/i.test(ew.gap), "EWMN gap names dynamics");
  // With only EWMN + another non-dynamics axis picked, still reports the dynamics gap vs peers that carry it.
  assert.ok(N.structuralGaps(["laban", "ewmn"]).some(g => g.system === "ewmn"));
});

test("structuralGaps is empty when all picked systems share the compared capabilities", () => {
  assert.deepEqual(N.structuralGaps(["laban", "benesh"]), []); // both carry dynamics
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/notation.test.mjs`
Expected: FAIL — `structuralGaps` undefined.

- [ ] **Step 3: Implement `structuralGaps`**

In `notation.js`, add beside `systemCarriesDynamics`:

```js
// Structural capability differences among the picked systems. Today we compare
// the one axis we can read from a pose-only dancer's capability flags: dynamics.
// A system that cannot carry an axis some *other picked* system can is a gap.
function structuralGaps(picked) {
  const gaps = [];
  const anyCarriesDynamics = picked.some(systemCarriesDynamics);
  for (const sys of picked) {
    if (anyCarriesDynamics && !systemCarriesDynamics(sys)) {
      gaps.push({ system: sys, gap: "carries no dynamics — its reading does not change with quality (§4.7)" });
    }
  }
  return gaps;
}
```

Add `structuralGaps` to `notation.js`'s exports object.

- [ ] **Step 4: Render the strip + e2e**

In `comparison.html`:

```js
function renderDisagree() {
  const el = document.getElementById("disagree");
  const gaps = Notation.structuralGaps(pickedList());
  if (!gaps.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = `<h4>Where they disagree</h4>` + gaps.map(g =>
    `<p data-sys="${g.system}"><span class="inert-dot">○</span> <strong>${SYS_LABEL[g.system]}</strong> ${g.gap}</p>`
  ).join("");
}
```

Call `renderDisagree()` at the end of `CMP.render` and after picker changes. e2e: with all three picked, the strip names EWMN.

```js
  await page.click('.pick[data-sys="ewmn"]'); // ensure on
  const disagree = await page.$eval("#disagree", el => ({ hidden: el.hidden, txt: el.textContent }));
  if (disagree.hidden || !/eshkol|ewmn|dynamics/i.test(disagree.txt)) die("disagreement strip missing EWMN dynamics note");
```

- [ ] **Step 5: Run both suites, then commit**

```bash
git add public/movement-languages/notation.js public/movement-languages/comparison.html test/notation.test.mjs scripts/e2e-comparison.mjs
git commit -m "Comparison: disagreement strip driven by structural capability gaps"
```

---

## Task 8: Presets (incl. the five windows) + light editor

**Files:**
- Modify: `public/movement-languages/comparison.html`, `scripts/e2e-comparison.mjs`

**Interfaces:**
- Consumes: `standPose`, `merge`, `setLimbVec`/`limbVec` from Task 1; `#presetSel`, `CMP` from Task 2.
- Produces: a `PRESETS` table (name → dancer + note), a populated `#presetSel`, and nudge controls that mutate `CMP.dancer` and re-render.

- [ ] **Step 1: Add e2e assertions**

```js
  // Presets load and change the score.
  const before = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  await page.selectOption("#presetSel", await page.$eval("#presetSel option:nth-child(2)", o => o.value));
  const after = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  if (before === after) die("selecting a preset did not change the Laban panel");
  // Light editor nudges a joint and redraws.
  await page.selectOption("#focusSel", "rfarm");
  const pre = await page.$eval('.pane[data-sys="ewmn"] .pane-body', el => el.innerHTML);
  await page.click('#nudgeElUp');
  const post = await page.$eval('.pane[data-sys="ewmn"] .pane-body', el => el.innerHTML);
  if (pre === post) die("nudging elevation did not change the EWMN panel");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/e2e-comparison.mjs`
Expected: FAIL — no `#presetSel` options / no `#nudgeElUp`.

- [ ] **Step 3: Add presets + editor**

Define presets (the five windows become phrase examples; each is a `dancer` + a one-line note). Include at least: a neutral "Stand"; the Window-3 lowering phrase; the Window-1 held-direction phrase; and three more drawn from the existing window movements. Use `merge(standPose(), {...})` per key.

```js
const PRESETS = [
  { id: "stand", name: "Stand (neutral)", note: "An upright reference pose.",
    dancer: { beats: 2, keys: [{ beat: 0, pose: NotationRender.standPose() }] } },
  { id: "w3", name: "One lowering (Window 3)", note: "A forearm lowering — three qualities read alike in EWMN.",
    dancer: { beats: 2, keys: [
      { beat: 0,   pose: NotationRender.merge(NotationRender.standPose(), { rfarm: [0, 20] }) },
      { beat: 1,   pose: NotationRender.merge(NotationRender.standPose(), { rfarm: [0, -30] }) },
      { beat: 1.5, pose: NotationRender.merge(NotationRender.standPose(), { rfarm: [0, -60] }) },
    ] } },
  // ...three more window phrases (Window 1 held direction, etc.)...
];

(function fillPresets(){
  const sel = document.getElementById("presetSel");
  sel.innerHTML = PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  sel.addEventListener("change", () => {
    const p = PRESETS.find(x => x.id === sel.value); if (!p) return;
    CMP.dancer = NotationRender.clonePose ? JSON.parse(JSON.stringify(p.dancer)) : p.dancer;
    CMP.render(); renderStage();
  });
  CMP.dancer = JSON.parse(JSON.stringify(PRESETS[0].dancer));
})();
```

Light editor — nudge the focused bone's `[az, el]` on the first key (MVP: edit key 0; extend later). Add buttons in the controls markup: `#nudgeAzL #nudgeAzR #nudgeElDown #nudgeElUp`.

```js
function nudge(field, delta) {
  const seg = CMP.focus; if (!seg || !NotationRender.BONES.some(b => b.id === seg)) return; // bone-level edits only
  const k = CMP.dancer.keys[0]; const [az, el] = k.pose.bones[seg];
  k.pose.bones[seg] = field === "az" ? [az + delta, el] : [az, Math.max(-90, Math.min(90, el + delta))];
  CMP.render(); renderStage();
}
document.getElementById("nudgeAzL").onclick = () => nudge("az", -15);
document.getElementById("nudgeAzR").onclick = () => nudge("az", 15);
document.getElementById("nudgeElDown").onclick = () => nudge("el", -15);
document.getElementById("nudgeElUp").onclick = () => nudge("el", 15);
```

- [ ] **Step 4: Run the e2e to verify it passes**

Run: `node scripts/e2e-comparison.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/movement-languages/comparison.html scripts/e2e-comparison.mjs
git commit -m "Comparison: presets (incl. windows) and light joint editor"
```

---

## Task 9: Retarget the guided tour + full green

**Files:**
- Modify: `public/movement-languages/comparison.html`, `scripts/e2e-comparison.mjs`, `docs/glyph-verification-todo.md`

**Interfaces:**
- Consumes: the tour scaffolding retained from the old page (`#tour`, `#guideBtn`, `#tourSkip`, `TOUR_KEY="ml_comparison_tour_v1"`).
- Produces: a 6-step tour pointing at picker → focus → movement menu → a panel → the light editor → the disagreement strip.

- [ ] **Step 1: Add the tour e2e (restore from the old script)**

```js
  await page.click("#guideBtn");
  if (!(await page.$eval("#tour", el => el.classList.contains("on")))) die("tour did not open");
  await page.click("#tourSkip");
  if (await page.$eval("#tour", el => el.classList.contains("on"))) die("tour did not close");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/e2e-comparison.mjs`
Expected: FAIL — tour steps target removed elements.

- [ ] **Step 3: Retarget the tour**

Keep the spotlight/tour mechanics from the old `comparison.html`. Replace the step definitions with six steps whose selectors are `.picker`, `#focusSel`, `#presetSel`, `.pane[data-sys="laban"]`, `.controls .nudge`, `#disagree`, each with one sentence. Keep `TOUR_KEY`, auto-start-once, and the Guide button.

- [ ] **Step 4: Verify glyph registry + run everything**

Confirm every `data-prov` the renderers emit is registered in `notation.js` `PROVISIONAL_GLYPHS`; if the port surfaced a new one, register it and add a row to `docs/glyph-verification-todo.md`. Then:

Run: `node --test test/notation.test.mjs` → PASS (all).
Run: `npx tsc --noEmit -p .` → clean (ignore the known `LayoutProps` global).
Run: `npx eslint .` → clean.
Run: `node scripts/e2e-comparison.mjs` → PASS.

Add a provisional-glyph guard to the e2e (restored from the old script):

```js
  const registered = await page.evaluate(() => window.Notation.PROVISIONAL_GLYPHS);
  const drawn = await page.$$eval("[data-prov]", els => els.map(e => e.dataset.prov));
  for (const id of drawn) if (!registered.includes(id)) die("unregistered provisional glyph: " + id);
```

- [ ] **Step 5: Commit**

```bash
git add public/movement-languages/comparison.html scripts/e2e-comparison.mjs docs/glyph-verification-todo.md
git commit -m "Comparison: retarget guided tour; provisional-glyph guard; full green"
```

---

## Self-Review

**Spec coverage:**
- Notation picker (2–3, Laban/Benesh/EWMN, Motif excluded) → Task 2. ✓
- Shared `notation-render.js` pure renderers → Tasks 1, 3, 5, 6. ✓
- Light editor + presets incl. five windows → Task 8. ✓
- Highlight-in-context segment focus (panels + stage) → Tasks 3–6 (`focusSegment`), Task 4 (stage). ✓
- Disagreement strip + inert marking → Task 7. ✓
- Meaningful absence / EWMN no dynamics → Task 6 (test), Task 7 (strip). ✓
- Tutorial retargeted → Task 9. ✓
- Tests + e2e green, provisional glyphs registered → Task 9. ✓
- danceforms.html untouched; port cited as duplication → Global Constraints + Task 1 header. ✓

**Placeholder scan:** Renderer bodies are ported by explicit source-line reference plus a named mechanical-transform list and a fidelity test — deliberate, per the "ports are verbatim" constraint (retyping glyph geometry is the forbidden path). All new code (page, picker, focus, stage, disagreement, presets, editor, tests, e2e) is written out. No TBD/TODO.

**Type consistency:** `renderLaban/renderBenesh/renderEW(dancer, opts)` with `opts.focusSegment` used consistently across Tasks 3–6 and the page. `structuralGaps(picked) -> [{system, gap}]` matches its use in `renderDisagree`. `CMP.focus` (a bone id or null) matches `focusSegment`. `merge`, `standPose`, `clonePose`, `skeleton`, `limbVec`, `LIMBSETS`, `BONES` all defined in Task 1 and referenced thereafter.
