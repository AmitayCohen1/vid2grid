import { test } from "node:test";
import assert from "node:assert/strict";
import { CausalSnapper, LiveScore, resampleLive, type LiveSample } from "../lib/live";
import { DEFAULT_GRID } from "../lib/grid";
import { DEFAULT_SMOOTH, PoseSmoother, smoothPoses, snapPoses } from "../lib/score";
import { LiveFollower, type Anchor } from "../lib/follow";
import { BONE_IDS, type BoneId } from "../lib/skeleton";
import type { Extraction, Pose } from "../lib/pose";
import type { AzEl } from "../lib/geometry";

function pose(t: number, over: Partial<Record<BoneId, AzEl>> = {}, extra: Partial<Pose> = {}): Pose {
  const bones = Object.fromEntries(BONE_IDS.map((id) => [id, over[id] ?? [0, -70] as AzEl])) as Pose["bones"];
  bones.torso = [0, 88]; bones.head = [0, 85]; bones.shoulders = [90, 0];
  return { t, facing: 10, x: 0.3, z: -0.1, hipY: 0.95, bones, conf: 1, ...extra };
}

function extraction(t: number, over: Partial<Record<BoneId, AzEl>> = {}): Extraction {
  const lengths = Object.fromEntries(BONE_IDS.map((id) => [id, 0.3])) as Record<BoneId, number>;
  return { pose: pose(t, over), lengths, hipWidth: 0.25, shoulderWidth: 0.38, metresPerUnit: 2 };
}

test("CausalSnapper: a new direction shows after minDwell frames, never before, and is one keyframe", () => {
  const g = { ...DEFAULT_GRID, minDwell: 4 };
  const s = new CausalSnapper(g);
  let keys = 0;
  const first = s.push(pose(0));
  assert.ok(first.keyframe); keys++;
  assert.deepEqual(first.pose.bones.ruarm, [0, -67.5]);
  // Sweep the right upper arm out to the side: raw 90° az, level.
  const out: AzEl = [90, 0];
  const seen: AzEl[] = [];
  for (let i = 1; i <= 8; i++) {
    const r = s.push(pose(i / 30, { ruarm: out }));
    if (r.keyframe) keys++;
    seen.push(r.pose.bones.ruarm);
  }
  // Frames 1..3 still hold the old cell; frame 4 (the 4th frame of the new cell) accepts it.
  assert.deepEqual(seen[0], [0, -67.5]);
  assert.deepEqual(seen[2], [0, -67.5]);
  assert.deepEqual(seen[3], [90, 0]);
  assert.deepEqual(seen[7], [90, 0]);
  assert.equal(keys, 2);
});

test("CausalSnapper: with minDwell 1 the cell changes at once, with hysteresis", () => {
  const g = { ...DEFAULT_GRID, minDwell: 1, hysteresis: 0.3 };
  const s = new CausalSnapper(g);
  s.push(pose(0, { rfarm: [0, 0] }));
  // 15° is past half a step (11.25°) but not past the hysteresis limit (18°): hold.
  assert.deepEqual(s.push(pose(0.1, { rfarm: [15, 0] })).pose.bones.rfarm, [0, 0]);
  assert.deepEqual(s.push(pose(0.2, { rfarm: [20, 0] })).pose.bones.rfarm, [22.5, 0]);
});

test("PoseSmoother is smoothPoses, one frame at a time", () => {
  const poses = Array.from({ length: 40 }, (_, i) => pose(i / 30, { luarm: [Math.sin(i / 5) * 60, -30 + i] }, { x: 0.3 + i * 0.01, z: -0.1 }));
  const offline = smoothPoses(poses, DEFAULT_SMOOTH);
  const cx = 0.3 + 19.5 * 0.01; // median x of the run
  const s = new PoseSmoother(DEFAULT_SMOOTH, { x: cx, z: -0.1 });
  poses.forEach((p, i) => {
    const live = s.push(p);
    assert.deepEqual(live.bones.luarm, offline[i].bones.luarm);
    assert.ok(Math.abs(live.x - offline[i].x) < 1e-9);
    assert.equal(live.hipY, offline[i].hipY);
  });
});

test("resampleLive: irregular sightings land on the frame grid, held through short gaps only", () => {
  const samples: LiveSample[] = [
    { t: 0.00, extraction: extraction(0), image: null },
    { t: 0.04, extraction: extraction(0.04, { ruarm: [45, 0] }), image: null },
    { t: 0.09, extraction: null, image: null },           // not seen
    { t: 0.13, extraction: extraction(0.13, { ruarm: [90, 0] }), image: null },
    // a 1.2 s hole
    { t: 1.33, extraction: extraction(1.33, { ruarm: [135, 0] }), image: null },
  ];
  const frames = resampleLive(samples, 30, 1.5);
  assert.equal(frames.length, 45);
  assert.deepEqual(frames[0].extraction!.pose.bones.ruarm, [0, -70]);
  assert.deepEqual(frames[1].extraction!.pose.bones.ruarm, [45, 0]);   // 0.033 s: the 0.04 sighting is within half a frame
  assert.deepEqual(frames[3].extraction!.pose.bones.ruarm, [45, 0]);   // 0.10 s: the 0.13 sighting is still ahead, 0.04's holds
  assert.deepEqual(frames[4].extraction!.pose.bones.ruarm, [90, 0]);   // 0.133 s: within half a frame of 0.13
  assert.equal(frames[4].extraction!.pose.t, 4 / 30);                  // frame time, not sighting time
  assert.deepEqual(frames[10].extraction!.pose.bones.ruarm, [90, 0]);  // 0.33 s: held (gap 0.2 s)
  assert.equal(frames[30].extraction, null);                           // 1.0 s: 0.87 s since the last sighting — empty
  assert.deepEqual(frames[40].extraction!.pose.bones.ruarm, [135, 0]);
});

test("LiveScore (world lift): silent until the body is known, then a frame per push, holding through misses", () => {
  const live = new LiveScore({ grid: { ...DEFAULT_GRID, minDwell: 2 }, smooth: DEFAULT_SMOOTH, lift: "world" });
  assert.equal(live.push(extraction(0), 0), null);
  assert.equal(live.push(extraction(1 / 30), 1 / 30), null);
  const f = live.push(extraction(2 / 30), 2 / 30);
  assert.ok(f);
  assert.equal(f.body.lengths.ruarm, 0.3);
  assert.equal(f.keyframes, 1);
  // Not seen: the last pose is held with no confidence, still on the grid.
  const held = live.push(null, 3 / 30)!;
  assert.equal(held.raw.conf, 0);
  assert.deepEqual(held.snapped.bones.ruarm, f.snapped.bones.ruarm);
  // The dancer started at the centre of the stage.
  assert.ok(Math.abs(f.raw.x) < 1e-9 && Math.abs(f.raw.z) < 1e-9);
  // A held gesture becomes a keyframe once it has dwelt.
  for (let i = 4; i < 12; i++) live.push(extraction(i / 30, { ruarm: [90, 0] }), i / 30);
  assert.equal(live.keyframes, 2);
});

test("LiveScore: a live take, replayed offline, keeps the same directions", () => {
  const poses = Array.from({ length: 60 }, (_, i) => extraction(i / 30, { ruarm: i < 30 ? [0, -70] : [90, 0] }));
  const live = new LiveScore({ grid: DEFAULT_GRID, smooth: DEFAULT_SMOOTH, lift: "world" });
  const tidy = (b: AzEl | null | undefined): AzEl | null => (b ? [b[0] + 0, b[1] + 0] : null); // -0 → 0
  const seen = poses.map((e, i) => tidy(live.push(e, i / 30)?.snapped.bones.ruarm));
  const offline = snapPoses(smoothPoses(poses.map((e) => e.pose), DEFAULT_SMOOTH), DEFAULT_GRID).frames.map((p) => tidy(p.bones.ruarm)!);
  // Both end where the arm went; the live one arrives later (dwell, no back-dating).
  assert.deepEqual(seen[59], [90, 0]);
  assert.deepEqual(offline[59], [90, 0]);
  const liveAt = seen.findIndex((b) => b && b[0] === 90 && b[1] === 0);
  const offAt = offline.findIndex((b) => b[0] === 90 && b[1] === 0);
  assert.ok(liveAt >= offAt, `live ${liveAt} should not lead offline ${offAt}`);
});

test("LiveFollower: keeps to the nearest continuation and only reseeds after the gap", () => {
  const a = (x: number, size = 0.5): Anchor => ({ x, y: 0.5, size, box: { x: x - size / 4, y: 0.25, w: size / 2, h: size } });
  const f = new LiveFollower(3);
  assert.equal(f.pick([a(0.2, 0.3), a(0.7, 0.6)]), 1);           // biggest first
  assert.equal(f.pick([a(0.72, 0.6), a(0.2, 0.3)]), 0);          // followed, whatever the order
  assert.equal(f.pick([a(0.2, 0.3)]), -1);                       // gone: the bystander is not adopted
  assert.equal(f.pick([a(0.2, 0.3)]), -1);
  assert.equal(f.pick([a(0.2, 0.3)]), -1);
  assert.equal(f.pick([a(0.2, 0.3)]), 0);                        // after the gap, whoever is biggest
});
