# Glyph verification — to-do

The Comparison explainer (`public/movement-languages/comparison.html`) draws
some notation glyphs whose **exact form could not be verified against a
manual**. Per the invariants (see `CLAUDE.md` and the two reference docs), these
are drawn as clearly **provisional** — a dashed outline (invariant 6: dash =
provenance) and lighter fill — and registered in `notation.js`
(`PROVISIONAL_GLYPHS`). This file tracks what each one needs before it can be
promoted to verified.

A glyph is "verified" once its shape, proportion (invariant 7: size is
semantic) and placement have been checked against the cited edition and, where
relevant, confirmed with someone who reads the system. **Never** invent a
Laban-family symbol or autocomplete a Motif action stroke from memory; if a form
can't be verified, it stays provisional.

## Reused (inherited) glyphs — treated as verified-by-reuse, still worth a check

- **Labanotation direction/level symbol** (`labanSymbol` in comparison.html,
  copied verbatim from the Studio `danceforms.html`). Shape = direction, shading
  = level (low = filled, high = hatched, middle = hollow + centre dot), length =
  duration. This is standard Labanotation and is drawn solid, not provisional.
  Still: confirm the exact notch proportions and the hatch spacing against a
  current Labanotation manual (e.g. Guest, *Labanotation*, 4th ed.).

## Provisional glyphs drawn in Window 3 (quality)

| id | where | what it stands for | to verify |
|----|-------|--------------------|-----------|
| `laban.dynamics.impulse-wedge` | Laban panel, lane right of the symbol | impulse: dynamic stress at the onset, decaying | The accent/dynamics-line convention varies by school (§2.9). Confirm whether an impulse is drawn as a tapering wedge on the duration extent, an accent sign, or an effort-graph element, and its correct proportion/placement, against the edition in use. |
| `laban.dynamics.impact-wedge` | Laban panel, same lane | impact: stress building to a strike at the end | Same source as above; confirm the end-accented form. |
| `benesh.movement-line` | Benesh stave | the lowering path across the stave | Confirm Benesh sagittal movement-line geometry and how a descent is written (from behind). Source: Benesh Movement Notation manual / RAD. |
| `benesh.frame` | Benesh stave | recorded start/end positions ("frames") | Confirm how a frame/position is marked on the stave and its size unit. |
| `benesh.quality-lane.stress` | above the Benesh stave | dynamic quality (impulse/impact/even) in the above-stave lane | Confirm what marks live in the above-stave lane and how stress/accent and a sustained (even) quality are written (§3.5). |
| `ewmn.movement.plane` | EWMN manuscript | a plane movement between positions (identical across variants) | Confirm the Eshkol-Wachman sign for a plane (as opposed to conical/rotatory) movement and how position numerals are placed. Source: Eshkol & Wachman, *Movement Notation*. (This glyph must stay dynamics-free — §4.7.) |
| `motif.action-stroke` | Motif panel, left | the action stroke (spatial content, thinned) | No verified Motif renderer exists in this project. Confirm the action-stroke form and that it is never auto-completed. Source: Guest, *Your Move* / Motif notation reference. |
| `motif.effort.graph` | Motif panel, centre | the effort graph that takes over the score (§5.4) | Confirm the effort-graph convention (axes, what rising/falling means) and its proportion. |

## Provisional glyphs drawn in Window 1 (reference frame)

| id | where | what it stands for | to verify |
|----|-------|--------------------|-----------|
| `laban.key-signature` | Laban panel, foot of the staff | the Cross-of-Axes key signature (standard / body / stance) in force (§2.11) | Confirm the actual key-signature glyphs for the standard, body and stance crosses and their placement (start of section vs. beside symbols). Source: Guest, *Labanotation*. The tinted gutter (hue = active frame) is a teaching device, not a notation mark, and is drawn solid. |

Note: Window 1's gnomon (stage), the EWMN reoriented SoR sphere and its nested child sphere, and the Benesh resolved depth sign are drawn as **diagrams** the visualization spec prescribes (§2.11 body view, §4.1/§6.3, §3.x), not as notation glyphs, so they are not in the provisional registry; the underlying frame geometry is the sagittal-plane simplification documented in `notation.js` (`resolveDirection`).

## Process

When a glyph is verified: replace its provisional drawing in
`comparison.html`, remove its id from `PROVISIONAL_GLYPHS` in `notation.js`
(and update `test/notation.test.mjs`), and strike its row here with a note on
the source used.
