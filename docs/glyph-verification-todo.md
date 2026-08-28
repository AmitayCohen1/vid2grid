# Glyph verification — to-do

The Comparison explainer (`public/movement-languages/comparison.html`) is the
**focused-Studio Comparison** tool: a notation picker (choose two or three of
Labanotation / Benesh / Eshkol-Wachman), a stage figure, and one live panel
per picked system, all driven by `notation-render.js` — pure renderer
functions **ported verbatim** from the Studio (`danceforms.html`) glyph code,
by explicit source-line reference (see the port-provenance comments at the
top of `notation-render.js`), not retyped from memory. This tool **replaced**
an earlier **windowed** `comparison.html` (five fixed "windows," each
isolating one axis of disagreement, with its own hand-drawn provisional
glyphs) that shipped first and was then rewritten out from under this
document over the course of this project's later tasks. This document
originally tracked that windowed page's provisional glyphs; it is rewritten
below to match the tool that actually shipped.

Per the invariants (see `CLAUDE.md` and the two reference docs), a glyph is
**provisional** — drawn with a dashed outline (invariant 6: dash =
provenance) and lighter fill, marked `data-prov="<id>"`, and registered in
`notation.js` (`PROVISIONAL_GLYPHS`) — when its exact form could not be
verified against a manual. A glyph is **verified** once its shape, proportion
(invariant 7: size is semantic) and placement have been checked against a
cited edition and, where relevant, confirmed with someone who reads the
system. **Never** invent a Laban-family symbol or autocomplete a Motif action
stroke from memory; if a form can't be verified, it stays provisional.

## Current state: verified-by-reuse, not provisional

`notation-render.js`'s `renderLaban`, `renderBenesh` and `renderEW` all reuse
the same glyph-drawing code already shipped and reviewed in the Studio
(`danceforms.html`) — the direction/level symbol, the Benesh stave and
figure marks, and the Eshkol-Wachman manuscript signs are not redrawn from
scratch for Comparison, they are the identical drawing logic ported as pure
functions. None of the three live panels emit a `data-prov` marker; the
provisional-glyph e2e guard (`scripts/e2e-comparison.mjs`) confirms this by
construction — it collects every `[data-prov]` element actually drawn on the
page and fails if any drawn id isn't in `PROVISIONAL_GLYPHS`, which today
means it finds **zero** drawn provisional glyphs. That is the expected,
correct result for this tool, not a gap in the check — the guard exists as a
safety net for if a future port or new system introduces an unverified form.

- **Labanotation direction/level symbol** (`labanSymbol`, ported from the
  Studio's `danceforms.html`). Shape = direction, shading = level (low =
  filled, high = hatched, middle = hollow + centre dot), length = duration.
  Standard Labanotation, drawn solid. Still worth confirming the exact notch
  proportions and hatch spacing against a current manual (e.g. Guest,
  *Labanotation*, 4th ed.) — verified-by-reuse, not independently checked.

- **Benesh stave and figure marks** (ported Benesh renderer). The stave
  lines, note-head placement and limb-path drawing are the same code the
  Studio already uses. Verified-by-reuse in the same sense as the Laban
  symbol above; still worth confirming stave proportions and movement-line
  geometry against the Benesh Movement Notation manual / RAD.

- **Eshkol-Wachman manuscript signs** (ported EWMN renderer). The grid,
  position numerals and movement signs are the same code the Studio already
  uses, and — per invariant 8 — the panel carries no dynamics lane at all
  (EWMN structurally omits dynamics, §4.7), so there is no dynamics glyph to
  verify or mark provisional here. Still worth confirming plane/rotatory
  movement-sign form against Eshkol & Wachman, *Movement Notation*.

## Motif — still excluded, no verified renderer

Motif is deliberately **not** one of the pickable systems in this tool (see
the picker in `comparison.html`: Labanotation, Benesh, Eshkol-Wachman only).
No Motif renderer — verified or provisional — exists in this project. If
Motif is ever added, its action-stroke and effort-graph forms must be
verified against a manual (e.g. Guest, *Your Move* / Motif notation
reference) before being drawn solid; until then, per the invariant, any
attempt must render as clearly provisional rather than guessed from memory.

## Superseded: the old windowed design's provisional glyphs

The earlier windowed `comparison.html` (five fixed windows: reference frame,
sequence, quality, phrasing, orchestration) did implement and draw hand-made
provisional glyphs, each wrapped in a `data-prov="<id>"` marker — Laban
dynamics wedges (impulse/impact), a Benesh movement-line/frame/quality-lane,
an Eshkol-Wachman plane-movement sign, a Motif action-stroke and effort-graph
(Motif was pickable in that design), and a Laban key-signature. That whole
page — including its Motif panel — was removed and rebuilt from scratch as
the picker/focus/preset tool now shipped (see the task-by-task rewrite
starting at commit `0dd5505`), so none of those hand-drawn provisional
glyphs exist in `comparison.html` any more; there is nothing live left to
verify. `PROVISIONAL_GLYPHS` in `notation.js` still lists their ids as a
historical registry (harmless — nothing draws them, so nothing can go
unregistered by the e2e guard). If a future design resurrects any of that
windowed content, or adds Motif back, re-add a row here per glyph before
drawing it provisionally, and remove its id from `PROVISIONAL_GLYPHS` only
once it is actually verified and drawn solid.

## Process

When a glyph is verified: replace its provisional drawing in
`comparison.html`/`notation-render.js`, remove its id from
`PROVISIONAL_GLYPHS` in `notation.js` (and update
`test/notation.test.mjs`), and strike its row here with a note on the source
used. When a new provisional glyph is introduced: mark it with
`data-prov="<id>"`, register the id in `PROVISIONAL_GLYPHS`, and add a row to
this file — the e2e guard will fail the build if a drawn id is left
unregistered.
