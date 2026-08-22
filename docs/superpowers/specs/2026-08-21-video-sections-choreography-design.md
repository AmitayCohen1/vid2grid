# Video sections → notation choreography — design

**Date:** 2026-08-21 · **Branch:** `movement-languages` · **Status:** approved

## Goal

Combine vid2grid with the movement-languages pages so that a tracked video becomes
a **section** — up to 8 beats of quantized keyframes — that danceforms.html can
sequence into a **choreography**, played back, read and edited in Labanotation /
Benesh / Eshkol-Wachman, and output as JSON and captured video. The notation
renderings gain **finer direction resolution** so the compression into each
language keeps as much of the original as its vocabulary allows.

Decisions made with the user:

- Integration style: **static pages + shared format** (no React port; no renderer
  extraction).
- Tempo: **motion-derived estimate, always adjustable** (BPM slider, tap-tempo,
  phase offset). No audio analysis.
- Storage: **IndexedDB in the browser**; JSON export/import as backup. No server.
- Choreography: **ordered sequence** of sections on one timeline, per-item repeat
  counts, single dancer track to start.
- Output: stage playback + all notation renderings + JSON export + **captured
  video** (MediaRecorder → WebM).
- Fidelity upgrade: **finer directions only** (no extra body segments, no
  velocity-derived dynamics, no floor-plan detail — the data model does not
  preclude adding them later).
- New machinery split by strength: section-making in vid2grid (where the raw
  track lives), choreography-building in danceforms.html (where the stage and
  notation renderers live).

## Architecture

```
vid2grid/  (branch: movement-languages)
├── app/, components/, lib/          existing Next app, served at /
│   ├── components/SectionPanel.tsx  NEW — tempo, quantize, trim, save UI
│   └── lib/tempo.ts, lib/sectionize.ts, lib/sectionsDb.ts
│                                    NEW — engine modules, no React
└── public/movement-languages/
    ├── index.html                   copied Parameters page (+ nav, library picker)
    ├── danceforms.html              copied Studio (+ Library, Choreography, capture)
    └── section-store.js             NEW — shared IndexedDB helper (vanilla JS)
```

Data flow: video → existing vid2grid tracking/snapping → Section panel (estimate
tempo, adjust, quantize keyframes to nearest ¼ beat, pick ≤ 8-beat window, name,
save) → IndexedDB → danceforms Library drawer → Choreography builder (sequence +
repeats) → build onto the existing score model → playback / notations / JSON /
video capture.

Constraints and properties:

- The static pages keep their no-build, single-file character except for one
  shared `<script src="section-store.js">` (~100 lines: DB name, store names,
  format validation, list/get/put/delete, export/import). The TS side implements
  the same documented schema in `lib/sectionsDb.ts` — Next cannot import modules
  from `public/`, and a build-copy step would cost the pages their no-build
  property, so the schema is duplicated deliberately and kept small.
- Everything stays in the browser (per vid2grid's CLAUDE.md). IndexedDB is
  per-origin: the library is shared only when the pages are served by the app
  (localhost:3000 in dev). `file://` opens won't see it; JSON import/export is
  the escape hatch.
- Nav: the app header links to both static pages; the pages link to each other
  and back to `/`. danceforms' hardcoded claude.ai artifact URL for the
  Parameters page becomes a relative link.
- The originals in `Documents/movement-languages/` are not modified; the branch
  carries copies.

## Data model

### Section (shared contract, versioned)

```json
{
  "v": 1,
  "id": "uuid",
  "name": "Kathak arm sweep",
  "createdAt": 1755772800000,
  "tempo": 92,
  "beats": 8,
  "source": { "file": "clip.mp4", "startSec": 3.2, "endSec": 8.4 },
  "keys": [
    { "beat": 0, "pose": { "x": 0, "z": 0, "facing": 45, "hipY": 0.98,
        "bones": { "torso": [0, 86], "head": [0, 76], "ruarm": [16, -74],
                   "rfarm": [10, -84], "luarm": [-16, -74], "lfarm": [-10, -84],
                   "rthigh": [5, -86], "rshin": [2, -89],
                   "lthigh": [-5, -86], "lshin": [-2, -89] } } },
    { "beat": 1.25, "pose": { "…": "…" } }
  ]
}
```

- `beats` ≤ 8 (integer). `keys[].beat` are multiples of **0.25** in
  `[0, beats]`; a key always exists at beat 0.
- `pose` is exactly danceforms' pose shape: stage `x`/`z` (metres), `facing`
  (degrees), `hipY` (metres), and ten body-local `(azimuth, elevation)` segments
  in degrees. The ten segment ids are precisely vid2grid's `core: true` bones
  (`torso head ruarm rfarm luarm lfarm rthigh rshin lthigh lshin`); saving drops
  `shoulders`/`hands`/`feet`. Consumers ignore unknown bone ids, so the format
  can grow.
- Angles are **continuous degrees** — the grid-snapped cell centers from
  vid2grid, not re-coarsened to 8×3. This is what the finer-direction renderings
  read.
- `tempo` records capture BPM; beats are abstract, so choreographies may replay
  at another tempo.
- **Implementation check (must be verified with a test pose before conversion
  code is trusted):** both sides use body-local azimuth 0 = forward, positive =
  dancer's right; confirm numeric ranges and wrapping (−180..180) match between
  `lib/pose.ts`/`lib/grid.ts` and danceforms' renderer.

### Choreography

```json
{ "v": 1, "id": "uuid", "name": "Study #1", "tempo": 100,
  "items": [ { "sectionId": "uuid", "repeat": 2 } ] }
```

Ordered sequence; total length = Σ `beats × repeat`. Sections are referenced by
id, not copied: editing a section reaches every choreography using it on that
choreography's next build; a deleted
section renders as a missing item (skipped with a visible warning), never a
crash. Default `tempo` = first section's capture tempo.

### Storage

IndexedDB database `movement-languages`, version 1, object stores `sections`
and `choreographies`, both `keyPath: "id"`. The helper exposes
list/get/put/delete + export-all/import-file. If IndexedDB is unavailable
(some private-browsing modes), the UI says so; JSON import/export still works.

## Section panel (vid2grid)

New `components/SectionPanel.tsx`, active once a clip is analyzed. All logic in
React-free `lib/` modules; the section is *derived* state — adjusting a knob
re-derives instantly without re-tracking, like the score itself.

- **Tempo estimation** (`lib/tempo.ts`): movement-intensity signal = mean
  angular speed across the ten core segments per frame, from the smoothed
  track; autocorrelate over 30–200 BPM; score candidates by how well existing
  keyframe onsets land on their beat grid; pre-fill BPM + phase offset with a
  confidence hint. Controls: BPM field + slider (30–200), tap-tempo, phase
  nudge. Beat lines are drawn on the existing timeline so the fit is visible
  against the keyframes before saving.
- **Quantization** (`lib/sectionize.ts`): keyframe at `t` s →
  `(t − offset) × BPM / 60` beats, snapped to nearest 0.25. Collisions on the
  same quarter-beat: the keyframe with the larger pose change wins. A beat-0
  key is synthesized from the pose at the window start. Poses come from the
  snapped score (the notation truth), converted to the shared pose shape.
- **Window & save**: drag a range on the timeline — start snapped to a whole
  beat, length a whole number of beats, ≤ 8 (matching the integer `beats`
  field). Quantized keys shown as diamonds on the beat grid; a
  preview toggle plays the quantized version on the 3D stage next to the raw
  score. Save to library (name + IndexedDB put) and/or Download JSON. Longer
  clips yield multiple sections from different windows.
- **Error handling**: too-short or too-still clips fall back to 100 BPM with
  manual controls foregrounded; estimation never blocks the panel.

## Studio (danceforms.html)

- **Library drawer**: saved sections (name, beats, tempo, date) with actions:
  add to choreography, load onto the selected dancer's track for inspection,
  delete, export/import JSON.
- **Choreography builder**: ordered list — add, reorder, repeat count, remove;
  total beats shown. **Build** writes the sequence onto a dancer track of the
  existing score model (keys concatenated, poses offset to their slot), so the
  existing timeline, stage playback, editable notations, and chance operations
  all work on choreography output unchanged. The sequence itself is saved to
  `choreographies` and can be reopened and rebuilt. Timeline interactions
  (add/nudge/scrub) gain quarter-beat snapping.
- **Video capture**: the stage is SVG; capture serializes each animation frame
  to an offscreen canvas (`canvas.captureStream()` → `MediaRecorder` → WebM
  download) while the choreography plays once through. Feature-detected; the
  button disables with an explanatory tooltip where unsupported.

## Finer directions (fidelity upgrade)

Poses already store continuous angles; only the renderings coarsen. So:

- **Labanotation**: staff symbols and the editing rose go from 8 to 16
  directions, with finer level shading.
- **Eshkol-Wachman**: grid reads true 45° units with half-unit (22.5°) marks —
  matching vid2grid's default grid exactly; cell-step editing moves in
  half-units.
- **Benesh**: wrist/ankle signs placed continuously from the actual angles
  instead of snapping to 8 slots; drag-editing (already continuous) stops
  rounding on store.
- index.html receives the same upgrade where its renderings share the old 8×3
  reduction.

## index.html (Parameters page)

Copied to `public/movement-languages/`, relative nav both ways, plus a **"load
from library" picker**: pulls a saved section into the four-system comparison by
compressing the ten-segment section into the page's four-channel event model
(`{channel, direction, level, duration, dynamic}`) — per key interval, the limb
that moved most becomes the event; direction/level from its angles; duration
from the gap to the next key. A visible demonstration of the compression the
project is about. **This picker is the first thing to cut if scope presses.**

## Testing

- `npx tsc --noEmit -p .` and `npx eslint .` as the repo already does.
- `node --test` units for the pure engine parts: tempo autocorrelation on
  synthetic signals (known BPM in, BPM out), quantization (rounding, collisions,
  beat-0 synthesis, window clamp), section format validation.
- Playwright end-to-end in the repo's existing pattern: upload the sample clip,
  save a section, open `/movement-languages/danceforms.html` on the same
  origin, verify it appears in the Library, build a choreography, assert keys
  land on quarter-beats.

## Out of scope (explicitly deferred)

- Audio-based beat detection; extra body segments in notations;
  velocity-derived dynamics/effort marks; floor-plan/turn-sign detail;
  multi-dancer layering of sections (free placement or duets); server storage
  and sharing; printable score layout.
