# Shared kernel — Studio and Comparison on one pose engine

**Date:** 2026-09-08 · **Branch:** `movement-languages` · **Status:** draft (awaiting user review)

Sub-project 0 of five. The other four (motion spine, untranslatable examples,
authoring, clip + record/export) each get their own spec and depend on this one.

## Goal

Make `danceforms.html` and `comparison.html` share one pose/geometry kernel
instead of two hand-synced copies. `notation-render.js` becomes the single
definition of the pose model, forward kinematics, limb helpers, interpolation
and the Laban quantizer; Studio loads it and deletes its inline copies.

This unfreezes `danceforms.html`, which the 2026-08-28 comparison spec froze for
the duration of that task and explicitly parked this follow-up behind:

> A **separate, later, separately approved** follow-up — once the user unfreezes
> danceforms.html — can make Studio `<script src="notation-render.js">` and delete
> its embedded copies, collapsing the duplication.

That approval is this document.

## Why now — the drift audit

The hand-sync arrangement has cost nothing *so far*, and that was worth
verifying rather than assuming:

- **The audit ran in both directions.** Forward (does every `notation-render.js`
  kernel line exist in Studio?) found near-total overlap. The reverse check —
  does every symbol defined in a removed block exist in `notation-render.js`? —
  found exactly one that does not: `labanToVec`, tabulated below.
- **Zero semantic drift today.** Of 127 normalised kernel lines in
  `notation-render.js`, **120 are byte-identical** to `danceforms.html`. The
  seven exceptions are two line-wrap artifacts (`vec`, `rotY` — same
  expressions, wrapped across two lines in Studio) and five genuinely
  Comparison-only lines (`standPose`, `merge`, and the `SEG_TO_LABANCOL` focus
  mapping Studio has no use for).
- **Three commits touched `danceforms.html` after the port** (`c338253` camera
  orbit, `eaddd19` plan view / range copy-paste / time shift, `661700f` cast
  uncapping). None edited a shared definition; the only shared-core lines they
  added were three new *call sites* of `clonePose`.

So this is not a rescue. It is done now because the next four sub-projects each
want another chunk lifted out of `danceforms.html` by hand — `poseAt` (:586) for
the motion spine, the Benesh sign-drag (:1874) for authoring, the MediaRecorder
block (:1786) for export — and because sub-project 2 performs surgery on the
quantizers, which exist in both files. Extracting `readingOf` from one copy while
the other keeps its own inline definition of "what does this system actually
record" is the one divergence in this project that would be a **correctness** bug
rather than a cosmetic one. Consolidating first makes that surgery single-site.

## Scope

**In.** The pure, DOM-free kernel — code that is already duplicated verbatim, or
that lives only in Studio and is needed by Comparison next.

**Out.** The three renderers (`renderLabanView` / `renderBeneshView` /
`renderEWView` and their `renderXTools` panels). See "What stays duplicated".

**Out.** `../standalone/`. Per README and CLAUDE.md it is a deliberately diverged
no-build edition and is not touched from here.

## The kernel — exact ledger

### Blocks removed from `danceforms.html`

| Lines | Contents | n |
|---|---|---|
| 476–498 | `BONES`, `BONE`, `STAND`, `clonePose` | 23 |
| 499–504 | `mkPose` | 6 |
| 572–583 | math banner, `D2R`, `vec`, `rotY`, `nlerp`, `lerp`, `lerpAngle`, `smooth`, `dirToAzEl` | 12 |
| 585–604 | `poseAt` | 20 |
| 606–638 | `skeleton` | 33 |
| 892–912 | `LIMBSETS`, `limbVec`, `setLimbVec`, `limbLen` | 21 |
| 914–964 | Laban banner, `DIR8`, `DIR16`, `DIR_ARROW`, `labanOf`, `hatchDef`, `labanSymbol`, `LABAN_COLS`, `labanQuantAt` | 51 |
| 1037 | `beneshDepthOf` | 1 |
| 1122–1125 | `ewCoord` | 4 |

**Nine blocks, 171 lines.** Net reduction ≈164, after the one added `<script>`
tag and the ~6-line preamble below.

Two banner comments are taken with their blocks (`/* ===== math ===== */` at
572, `/* ---- Laban quantization + symbol ---- */` at 914) because every symbol
under them leaves. The `/* ---- Eshkol-Wachman view ---- */` banner at 1121
**stays**, because `renderEWView` beneath it stays; only `ewCoord` is lifted out
from under it.

### Of those, what is new to `notation-render.js`

All but four groups are already present there verbatim, so removal is pure
deduplication. These move *up* rather than being deleted:

| Symbol | From | Why it moves |
|---|---|---|
| `nlerp`, `lerp`, `lerpAngle`, `smooth` | 578–582 | Interpolation primitives; absent from `notation-render.js` today. |
| `poseAt(d, t)` | 585–604 | **Sub-project 1 needs this.** Moving it beats copying it. |
| `mkPose(over)` | 499–504 | Pose constructor, sibling of the existing `standPose` / `merge`. |
| `labanToVec(q)` | 929–933 | The **inverse quantizer** (Laban symbol → limb vector). Studio's Laban rose editor calls it at 1458 / 1468 / 1477; it is absent from `notation-render.js`. Deleting its block without moving it up would break Studio's Laban editing. |

`standPose` / `merge` and `SEG_TO_LABANCOL` / `segToLabanCol` stay
Comparison-only and are **not** unified with `mkPose` or wired into Studio. Three
pose constructors with overlapping jobs is untidy, but collapsing them means
touching Studio's ten-entry `PRESETS` table and Comparison's preset list — real
edits to consumers, which is exactly what this sub-project is designed to avoid.
Leave them; revisit if a later sub-project gives a reason.

Note `poseAt` applies `smooth()` easing between keys. That easing is Studio's
existing behaviour and is preserved exactly; sub-project 1 inherits it rather
than choosing it.

### Exports

`notation-render.js` currently exports 15 symbols and omits several it already
defines (`limbLen`, `D2R`, `labanOf`, `labanQuantAt`, `labanSymbol`, `hatchDef`,
`DIR8`, `DIR16`, `DIR_ARROW`, `LABAN_COLS`, `beneshDepthOf`, `ewCoord`). The
export list grows to cover every symbol Studio needs, plus the three moved in.

## Mechanism — how Studio consumes it

`danceforms.html` has exactly one existing `<script src>` (`section-store.js`,
line 468). Add a second on line 469, before the inline script:

```html
<script src="section-store.js"></script>
<script src="notation-render.js"></script>
<script>
```

Then, at the top of the inline script, a destructuring preamble rebinds every
kernel symbol into the module scope Studio's code already expects:

```js
const { BONES, BONE, STAND, clonePose, mkPose, D2R, vec, rotY, nlerp, lerp,
        lerpAngle, smooth, dirToAzEl, poseAt, skeleton, LIMBSETS, limbVec,
        setLimbVec, limbLen, DIR8, DIR16, DIR_ARROW, labanOf, hatchDef,
        labanSymbol, labanToVec, LABAN_COLS, labanQuantAt, beneshDepthOf,
        ewCoord } = NotationRender;
```

**This is the whole risk-management strategy.** Every one of the ~2000 remaining
lines of Studio keeps its existing call sites unchanged — `skeleton(p)`,
`limbVec(pose, id)`, `poseAt(d, t)` all still resolve to bare identifiers. The
diff is seven deletions and two additions, with no rewriting of consumers.

Load order matters: `notation-render.js` is a UMD module assigning
`root.NotationRender`, so the tag must precede the inline script. Both pages are
served statically from `public/movement-languages/`, so the relative `src`
resolves identically for Studio and Comparison.

## What stays duplicated, and why

The three renderers stay in both files. Studio's carry `state.selK` /
`state.selPart` selection, click targets (`data-k`, `data-seg`) and the
`renderXTools` editing panels; Comparison's were deliberately stripped pure.
Unifying them means re-admitting selection state into the pure functions and
re-verifying an untested 2000-line page — cost now, benefit unclear.

What remains duplicated is **layout** code. That is the least dangerous kind to
have twice: a divergence in staff geometry is visible on screen, whereas a
divergence in a quantizer is silent and wrong. The dangerous half is exactly what
this sub-project consolidates.

`notation-render.js`'s header comment currently names `danceforms.html` as its
source of truth. That inverts: the module becomes the source of truth for the
kernel, and remains the *port target* for the renderers. The header says so.

## Testing

`danceforms.html` has **no test coverage of its own** — `test/notation.test.mjs`
covers `notation.js` and the pure renderers; the e2e scripts cover sections and
comparison. Refactoring untested UI is where things break quietly, so this
sub-project ships its own coverage. Without it we would be trading a
known-zero-drift duplication for an unverified refactor, which is a bad trade.

**Unit — `test/notation.test.mjs`**, for the three moved symbols:

- `poseAt` at a key beat returns that key's pose exactly (both endpoints).
- `poseAt` before the first key and after the last clamps, and does not
  extrapolate.
- `poseAt` at a midpoint returns bone directions that are **unit length** — the
  property that makes `nlerp`-on-the-sphere correct rather than a naive
  component-wise average of angles.
- `lerpAngle` takes the short way around the 350°→10° wrap (result 0°, not 180°).
- `smooth` easing: `smooth(0)===0`, `smooth(1)===1`, `smooth(0.5)===0.5`.
- `mkPose({})` deep-equals `standPose()`, and `mkPose` does not mutate `STAND`.

**Unit — kernel identity guard.** One test asserts `NotationRender` exports every
name in the destructuring preamble above. This is what fails loudly if a later
edit removes an export Studio depends on, since Studio itself is only checked by
e2e.

**New e2e — `scripts/e2e-studio.mjs`**, modelled on `e2e-comparison.mjs`
(Playwright, `pageerror` + console-error collection, `die()` on assertion):

- Page loads with **zero** page errors — this alone catches a missing export or
  a bad load order, the most likely failure mode of this refactor.
- The demo score renders: stage canvas non-blank, timeline shows keyframe
  diamonds.
- All three notation views are non-empty and contain real geometry
  (`/^<svg/` and a `path d="M"`, as the comparison e2e already asserts for Laban).
- Playback advances: press play, the transport time increases, press pause.
- Orbit responds: drag the stage, the rendered output changes.
- A pose edit round-trips: apply a palette pose, the Laban view's markup changes.

Added to `package.json`: `"e2e": "node scripts/e2e-sections.mjs && node
scripts/e2e-comparison.mjs && node scripts/e2e-studio.mjs"`.

**Regression baseline.** Before deleting anything, capture the three notation
views' serialised SVG for the demo score. After the refactor they must be
byte-identical — the kernel is verbatim-shared, so any difference is a mistake,
not an improvement. This is a throwaway check, not a committed test.

## Risks

| Risk | Mitigation |
|---|---|
| A kernel symbol is used by Studio but missed in the preamble → `ReferenceError` at runtime | The export-completeness unit test, plus the e2e's zero-page-errors assertion. Both fail loudly, neither silently. |
| Load-order or `file://` regression | Studio is served over HTTP from `public/`; the e2e loads it the same way. `../standalone/` keeps its self-contained copies and is untouched. |
| Deleting a block takes an adjacent Studio-only line with it | Exact line ranges are tabulated above; the SVG regression baseline catches any behavioural change. |
| Silent behaviour change from `smooth` easing arriving in Comparison | Comparison does not yet call `poseAt` — sub-project 1 introduces that deliberately. Nothing in Comparison changes behaviour in this sub-project. |

## Acceptance criteria

1. `danceforms.html` contains no definition of any symbol in the ledger; all
   nine blocks (171 lines) are gone.
2. `notation-render.js` exports every symbol in the preamble; `poseAt`, `mkPose`,
   `labanToVec` and the interpolation primitives live there and nowhere else.
   Studio's Laban rose editor (danceforms.html 1458 / 1468 / 1477) still writes
   a symbol back into a limb vector.
3. `npm test` green, including the new unit tests.
4. `npm run e2e` green, including the new `e2e-studio.mjs`.
5. The three notation views render byte-identically to the pre-refactor baseline.
6. Comparison's behaviour is unchanged.
7. `CLAUDE.md` updated: `danceforms.html` is no longer described as frozen; the
   kernel/renderer split and its source-of-truth direction are documented.

## Follow-ups this unblocks

- **Sub-project 1 (motion spine)** consumes `poseAt` directly instead of porting it.
- **Sub-project 2** extracts `readingOf` from the now-single-site quantizers.
- **Sub-projects 3 and 4** can share the sign-drag and MediaRecorder blocks on
  the same pattern, if that proves worthwhile when they arrive.
