# vid2grid

A short video of a dancer — or a few — → a **grid-snapped, playable 3D dance**.

Upload (or record from the webcam) a clip. The pose tracker runs entirely in your
browser, spells every body segment as a direction on the sphere — azimuth and
elevation in the dancer's own frame, the Eshkol-Wachman idea — and snaps it to a
discrete grid. **The snapped dance is the truth; the raw track is the evidence.**
Play it back on a 3D stage, read every limb in Laban / Eshkol-Wachman terms, and
see when the notation changes.

Or **go live**: with the camera as the source the dance is written as you move —
the figure, the grid and your cast follow you in real time, and when you finish
the take is kept as an ordinary dance, recording included. Live, each stage of
the pipeline runs causally (`lib/live.ts`): the body is re-measured as frames
arrive, the smoother is the same One-Euro filter, and a new direction shows once
it has held for the dwell — there is no back-dating, so the live figure runs a
few frames behind the offline dance. On Finish the take is resampled onto the
fixed frame rate and re-read by the whole-clip pipeline; that result is the
dance, not what the stage showed live.

There is also an **objects** view after Forsythe/OSU's *Synchronous Objects*: the
video annotated with traces, alignment lines between limbs, movement density,
and a generative drawing of the whole clip.

## Running it

```bash
npm install        # also copies the MediaPipe wasm + pose model into public/
npm run dev        # http://localhost:3000
npm run build
npm test          # engine regression checks
```

The opening studio includes three authored movement studies, so you can explore
the stage without supplying a video. Studies are synthetic poses, not captured
performances. Playback supports 0.25×–2× speed, looping, frame stepping, and a
keyboard-accessible playhead. The home screen is a real demo: a clip and a character performing its dance side by
side (`public/demo`, regenerated with `scripts/hero-data.ts`) and the cast; the header offers a way
back to the studio once it has been open. New dance opens a dialog to upload, record, go live, import, or choose an example.
The Dancer tab chooses how the movement reads: **Smooth** drives the figure from
the tracked motion (true to the video — best for watching and sharing), **Stepped**
from the grid-snapped dance (what the notation reads). It is display only: the
dance, the notation, and every export stay snapped either way. The translucent
ghost shows whichever track is not on stage.
**Beats** overlays the clip's pulse on the playhead and the notation roll —
`lib/tempo.ts` derives it from the movement itself (no audio), and it is always
overridable, including ÷2 / ×2 for the usual half-time confusion. Clips with no
clear pulse say so rather than guessing.
Videos and recordings are previewed before analysis begins, and the preview is
also where you **frame the dancer**: drag the box, drag its edges, scroll or use
the Zoom slider, or press *Fit to dancer* (the tracker looks at a few frames and
boxes everywhere the dancer was seen). Only the framed region is tracked and
shown, so a small figure in a wide shot gets the model's full resolution and the
video pane in Compare and Traces stays close up. When the paused frame holds
more than one person, each gets a *Follow* box: click a dancer and the tracker
keeps to them for the whole clip, forwards and backwards from that moment. Click
several (or *Follow all*) and every one becomes a dancer: the first is the dance
you edit, the others join the cast standing where they stood beside them in the
clip, each with a dance of their own. `lib/follow.ts` carries identity frame to
frame by the cheapest continuation — near where each person was heading, about
the same size, dressed the same (a torso colour signature, `lib/appearance.ts`)
— assigned jointly so two dancers are never the same body, with a jump limit
scaled to body size. Up to ten. Without a pick, the biggest body is followed;
*Fit to dancer* honours the picks too. Canceling analysis restores the
previous dance. The studio is one header (brand, project, view
tabs, actions) over the stage, with a permanent settings sidebar on the right —
Dancer, Movement grid, and Cast tabs, with Simple / Balanced / Detailed grid
presets and optional advanced tuning. It is always open, so every change is
visible on the stage while playback keeps running; it collapses to an icon rail
(Escape, or the chevron) and below 1100px the open panel floats over the stage.
Notation and Save use focused dialogs; on phones, dialogs become bottom sheets.

**Add dancer** (header button, or the Cast tab) puts more people on the shared
stage in one dialog: *who* (a character, a custom VRM, or the skeleton) and
*what they dance* — this dance again, alone or several entering a chosen number
of beats apart (a canon); another video, tracked off screen (`lib/clip.ts`)
while the dance on the stage stays as it is; a saved dance; or an example. The
Cast tab is the roster: the lead first, then a card per dancer that reads as one
line and opens to its *choreographic devices* (`lib/devices.ts`) — an
**entrance** delay (they wait in their first pose, then start), a **speed**,
**mirror** (the audience's mirror image), **reverse** (retrograde) — plus its
placement, size and look. The timeline stretches to the last dancer. In
**Compare**, the character and the whole cast can dance *inside the recording*
(Dancer → In the video): the tracker's 2D landmarks and metres-per-pixel put
each figure beside the person at their scale, feet on their floor, with no
camera calibration; the "Beside" slider moves the character and a cast member's
Across moves them relative to the person.

Video imports accept clips up to 120 seconds / 250 MB; 5–30 seconds remains ideal.
Dance imports validate the full pose sequence before opening it. Tracking gaps
preserve the original video timestamps and appear as low-confidence frames.
Smoothing and depth reconstruction are available for video analyses; imported
dances retain their baked smoothing while the grid remains editable.

If your environment blocks Turbopack's internal worker port, the supported
alternative is `npm run build -- --webpack`.

Nothing leaves the browser: no upload, no backend, no database. Dances can be
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
  and the whole dance re-snaps instantly. Laban's 8 directions × 3 levels and
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
- Still camera, whole bodies in frame. Several dancers are followed by position
  and clothing, which holds up while they stay apart or pass briefly; partnering,
  lifts and matching costumes can still swap two tracks, and there is no
  fix-up tool yet to say "from here, these two are swapped".
- No persistence beyond localStorage/JSON; Neon + Blob when sharing is wanted.
