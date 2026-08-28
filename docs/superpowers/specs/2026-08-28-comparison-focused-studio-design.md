# Comparison → focused Studio — design

**Date:** 2026-08-28 · **Branch:** `movement-languages` · **Status:** draft (awaiting user review)

## Goal

Rebuild the Comparison page (`public/movement-languages/comparison.html`) from a
fixed five-window explainer into a **focused version of the Studio**
(`danceforms.html`): the user picks **2–3 notations**, focuses on the **whole
body or one body segment**, and **authors or loads a movement**, seeing it read
live in each chosen notation side by side. The point of the original explainer —
that these systems are **not interchangeable** — is carried into the tool rather
than discarded.

Decisions made with the user:

- **Shape:** a focused, stripped-down Studio — notation picker + segment focus +
  light authoring — not a second full editor.
- **Live notations:** **Laban / Benesh / EWMN** (the three Studio already renders
  live). **Motif is excluded** from live user-driven rendering — no verified
  Motif renderer exists in this project and its glyphs must never be invented.
- **Windows fate:** **fold in as presets.** The five existing windows become
  loadable preset phrases; nothing built is thrown away.
- **Authoring:** **light editor + presets** — load a preset phrase (including the
  five windows) and nudge a few joints/keys, over the shared pose model. Not the
  full Studio editor.
- **Segment focus:** **highlight-in-context** — always show the whole body/score,
  but emphasize the chosen segment (bold it, dim the rest) in the stage and in
  every notation panel. Nothing is hidden.
- **Incommensurability teaching:** a **disagreement strip** under the panels names
  what a chosen system structurally cannot express for the current movement (e.g.
  dynamics in EWMN), carrying invariant 8 (meaningful absence) and the inert mark
  into the live tool. (The full per-window variant switcher is **not** preserved.)

## Architecture

```
vid2grid/  (branch: movement-languages)
└── public/movement-languages/
    ├── danceforms.html          Studio — FROZEN this task; not touched, not committed
    ├── comparison.html          REWORKED — picker + light editor + panels + strip
    ├── notation.js              EXISTING twin engine — unchanged or minor additive
    └── notation-render.js       NEW — pose model + pure Laban/Benesh/EWMN renderers
    test/notation.test.mjs        + unit tests for the pure renderers
    scripts/e2e-comparison.mjs    REWORKED — drives picker / focus / preset / strip
    docs/glyph-verification-todo.md  + any newly surfaced provisional glyphs
```

Data flow: preset or light edit → a `dancer` object (keyframes of body-local
poses) held by comparison.html → for each **picked** notation, call the matching
pure renderer in `notation-render.js` with `{ focusSegment }` → SVG string
injected into that panel → the disagreement strip reads the movement + picked
systems and marks what each cannot carry.

### `notation-render.js` — the key move

Studio's three renderers (`renderLabanView` at danceforms.html:894,
`renderBeneshView` at :967, `renderEWView` at :1055) are faithful and
keyframe-driven, but welded to Studio's DOM (`#labanView`), its edit/selection
state (`state.selK`, `state.selPart`, the `renderXTools` panels), and shared
primitives embedded in that file (`skeleton`, `limbVec`, `clonePose`,
`labanSymbol`, `DIR16`, `DIR8`, `BONES`, `LABAN_COLS`). Comparison cannot call
them as-is, and danceforms.html is frozen.

So we **port** — not rewrite — the needed logic into a new vanilla twin module,
the same pattern as `section-store.js` and `notation.js`:

- The pose model: bone/segment definitions, `skeleton()` forward kinematics,
  `limbVec`/`setLimbVec`, `clonePose`, `ewCoord`, `beneshDepthOf`, and the Laban
  quantizer + `labanSymbol`.
- Three **pure functions**, stripped of selection/editing/tools:
  - `renderLaban(dancer, opts) -> svgString`
  - `renderBenesh(dancer, opts) -> svgString`
  - `renderEW(dancer, opts) -> svgString`
  - `opts` carries `{ focusSegment, beats }`; `focusSegment` drives
    highlight-in-context (bold the segment's column/sign/row, dim the rest);
    omitted/`null` = whole body, everything at full weight.
- Provisional glyphs stay flagged exactly as they are today (`data-prov`,
  registered in `notation.js` `PROVISIONAL_GLYPHS`). The port invents nothing.

This module is loadable via UMD by comparison.html and `require()`-able by the
node test, so the ported renderers get real unit tests.

**Temporary duplication, acknowledged.** `notation-render.js` duplicates geometry
that also lives in the frozen `danceforms.html`. This is deliberate and
documented: the pages are no-build and cannot import from the Next app, and
danceforms.html must not be edited this task. A **separate, later, separately
approved** follow-up — once the user unfreezes danceforms.html — can make Studio
`<script src="notation-render.js">` and delete its embedded copies, collapsing the
duplication. Until then the two are kept in step by hand, and this file names
danceforms.html as its source of truth in a header comment.

### The `dancer` / movement model

A movement is a `dancer`: `{ keys: [{ beat, pose:{ bones: { segId:[az,el] } } }], beats }`
— the same body-local `(az, el)`-per-segment model the Studio pose engine and the
existing `notation.test.mjs` fixtures already use (`window3()`/`window1()` carry
`movement.keys` in exactly this shape). Presets are stored as `dancer` literals.

### comparison.html — the tool

- **Notation picker:** three checkboxes (Laban / Benesh / EWMN). Minimum two must
  stay checked — it is a *comparison*; unchecking to one is refused (the last two
  boxes disable further unchecking). Motif is not offered as a live panel.
- **Movement menu:** presets, including the five windows as example phrases, each
  with a one-line "what to notice" note. Selecting one loads its `dancer`.
- **Light editor:** pick a key and a segment, nudge `az`/`el` by small steps
  (buttons or a small slider), redraw. No add/delete-key, no timeline scrubbing,
  no multi-dancer — that is Studio's job.
- **Segment focus:** a "Whole body / <segment>" selector; the choice is passed as
  `focusSegment` to every renderer and to the stage skeleton draw.
- **Panels:** one SVG panel per *picked* notation, laid out in the existing
  responsive grid; a small canvas/SVG **stage** shows the skeleton with the
  focused segment bolded.
- **Disagreement strip:** below the panels, a line per structural gap for the
  current movement + picked systems — e.g. "EWMN ○ carries no dynamics; its
  reading does not change with quality." Driven by the model
  (`systemCarriesDynamics`, the reading's fields), reusing the inert/hollow ink
  states already in `notation.js`. If the movement exercises no gap under the
  current picks, the strip says so plainly rather than vanishing.

### Tutorial

The existing guided tour (`TOUR_KEY`, Guide button, auto-start-once) is retained
and **retargeted** to the new controls: picker → focus → movement menu → light
edit → read a panel → disagreement strip. Same open/close mechanics the e2e test
already checks.

## Testing

- **Unit (`test/notation.test.mjs`)** — the existing 22 tests stay green. Add
  tests over the pure renderers in `notation-render.js`: a known `dancer` in →
  the SVG contains the expected marks (Laban: a `path d="M` direction/level
  symbol; Benesh: an extremity depth sign; EW: the expected 45° numerals), and
  `focusSegment` changes the emphasis attributes for that segment only. Assert the
  port stays faithful: EWMN output carries no dynamics; provisional glyphs drawn
  are all registered.
- **E2E (`scripts/e2e-comparison.mjs`)** — reworked from the window/variant loop
  to the new flow: pick a preset; unchecking below two notations is refused;
  picking a segment bolds it in each panel and dims the rest; the disagreement
  strip appears and names the right inert system; every `data-prov` drawn is
  registered; the tour opens and closes. No console/page errors.
- The existing green bar (tsc, lint, `npm test`, e2e) is maintained.

## Constraints / properties

- **Additive and faithful (invariants 1, 8; glyph-fidelity rule).** No notation
  symbol is invented; unverified forms stay provisional and logged. EWMN never
  gains a dynamics slot. Meaningful absence is drawn (the strip + inert mark), not
  left blank.
- **danceforms.html is frozen** for this task — not edited, not committed. It
  carries the user's uncommitted PDF work. `notation-render.js` cites it as source
  of truth but does not touch it.
- **No-build pages preserved** — comparison.html gains one `<script
  src="notation-render.js">`; no bundler, no import from the Next app.
- **Uncommitted `README.md` / danceforms.html / package.json / CLAUDE.md changes
  are not committed** by this work; commits happen only when the user asks.

## Out of scope (YAGNI)

- Live Motif rendering (no verified renderer).
- The full per-window variant switcher (replaced by the disagreement strip).
- Full Studio authoring (add/delete keys, timeline, multi-dancer, capture, PDF).
- Extracting Studio's renderers by editing danceforms.html (deferred follow-up).
