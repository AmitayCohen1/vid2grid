# vid2grid

A short video of one dancer → a **grid-snapped, playable 3D score**.

Upload (or record from the webcam) a clip. The pose tracker runs entirely in your
browser, spells every body segment as a direction on the sphere — azimuth and
elevation in the dancer's own frame, the Eshkol-Wachman idea — and snaps it to a
discrete grid. **The snapped score is the truth; the raw track is the evidence.**
Play it back on a 3D stage, read every limb in Laban / Eshkol-Wachman terms, and
see when the notation changes.

There is also an **objects** view after Forsythe/OSU's *Synchronous Objects*: the
video annotated with traces, alignment lines between limbs, movement density,
and a generative drawing of the whole clip.

## Running it

```bash
npm install        # also copies the MediaPipe wasm + pose model into public/
npm run dev        # http://localhost:3000
npm run build
```

Nothing leaves the browser: no upload, no backend, no database. Scores can be
exported/imported as JSON and the last one is kept in localStorage.

## How it works

```
video ─► MediaPipe Pose (33 landmarks, 2D + rough 3D)     lib/tracker.ts
      ─► 2D-anchored lifting: image xy exact, depth clamped
         by the dancer's own bone lengths                     lib/lift.ts
      ─► dancer's frame from the hips; each segment → (az, el) lib/pose.ts
      ─► One-Euro smoothing (fast-adaptive)                   lib/filter.ts, lib/score.ts
      ─► snap to the grid with hysteresis + min dwell;
         keyframes where the notation changes                 lib/grid.ts, lib/score.ts
      ─► forward kinematics → 3D figure                        lib/fk.ts
      ─► Laban / Eshkol-Wachman readings                       lib/grid.ts
      ─► traces, alignments, density (objects view)            lib/objects.ts
```

- **Body-local space**: x = dancer's right, y = up, z = dancer's forward.
  Azimuth 0 = forward, 90 = right; elevation +90 = up.
- **The grid** is a setting (default 22.5° az / 22.5° el, facing 45°). Change it
  and the whole score re-snaps instantly. Laban's 8 directions × 3 levels and
  E-W's 45° units are read off the grid.
- **Stage frame** (three.js): x = audience's right, y = up, z = towards the
  audience/camera. Facing 0 = towards the camera.
- **Score JSON**: `{ source, grid, smooth, lift, body, raw[], frames[], keyframes[] }`
  where `raw` and `frames` are per-sample `Pose`s (`t, facing, x, z, hipY, bones{id: [az, el]}, conf`).

## Stack

Next.js 16 · React 19 · Tailwind 4 · @mediapipe/tasks-vision · three / react-three-fiber / drei.
The wasm runtime and `pose_landmarker_full.task` are self-hosted under `public/`
(gitignored; restored by `scripts/setup-assets.mjs` on install).

## Known limits / next steps

- Monocular depth is the weak point (a limb pointing at the camera is ambiguous).
  Upgrade paths: a GPU worker running a temporal mesh model (WHAM / GVHMR /
  SAM 3D Body class) writing the same JSON, or two phones for triangulation.
- One dancer, still camera, whole body in frame.
- No persistence beyond localStorage/JSON; Neon + Blob when sharing is wanted.
