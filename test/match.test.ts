import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_BONES, MatchTracker, directionCredit, grade, matchAt, matchPose } from "../lib/match";
import { createDemo } from "../lib/demo";
import { mirrorPose } from "../lib/devices";

test("directionCredit: full within half a step, none beyond a step and a half, linear between", () => {
  assert.equal(directionCredit([0, 0], [0, 0], 22.5), 1);
  assert.equal(directionCredit([0, 0], [10, 0], 22.5), 1);
  assert.ok(Math.abs(directionCredit([0, 0], [22.5, 0], 22.5) - 0.5) < 1e-9);
  assert.equal(directionCredit([0, 0], [40, 0], 22.5), 0);
  assert.equal(directionCredit([0, 0], [180, 0], 22.5), 0);
  // Azimuth is meaningless at the pole: straight up is straight up.
  assert.equal(directionCredit([0, 90], [180, 90], 22.5), 1);
});

test("matchPose: a pose matches itself, and a limb off by a lot costs a tenth", () => {
  const sc = createDemo("reach");
  const p = sc.frames[40];
  assert.equal(matchPose(p, p, 22.5).score, 1);
  const off = { ...p, bones: { ...p.bones, ruarm: [p.bones.ruarm[0] + 90, p.bones.ruarm[1]] as [number, number] } };
  const m = matchPose(off, p, 22.5);
  assert.ok(Math.abs(m.score - 0.9) < 1e-9);
  assert.equal(m.bones.ruarm, 0);
  assert.equal(CORE_BONES.length, 10);
});

test("matchAt: finds the best frame in the window, mirrored by default, and ends after the dance", () => {
  const sc = createDemo("reach");
  const t = 2;
  const exact = sc.frames[Math.round(t * sc.source.fps)];
  // Live pose = the mirror of the target at t → a perfect mirrored match with no lag.
  const m = matchAt(mirrorPose(exact), sc, t)!;
  assert.equal(m.score, 1);
  assert.equal(m.lag, 0);
  // Un-mirrored comparison of a mirrored pose is worse (the arms swap sides).
  const un = matchAt(mirrorPose(exact), sc, t, { step: 22.5, window: 0.3, mirror: false })!;
  assert.ok(un.score < 1);
  // Running 0.2 s late still scores perfectly, with the lag reported.
  const late = matchAt(mirrorPose(exact), sc, t + 0.2)!;
  assert.equal(late.score, 1);
  assert.ok(Math.abs(late.lag - 0.2) < 1e-6);
  assert.equal(matchAt(exact, sc, sc.source.duration + 1), null);
});

test("MatchTracker: means, per-bone means and the longest good streak", () => {
  const tr = new MatchTracker();
  const bones = (v: number) => Object.fromEntries(CORE_BONES.map((id) => [id, v])) as Record<(typeof CORE_BONES)[number], number>;
  for (let i = 0; i < 30; i++) tr.push({ score: 1, bones: bones(1), lag: 0.1 }, i / 30);          // 1 s good
  for (let i = 30; i < 45; i++) tr.push({ score: 0.2, bones: bones(0.2), lag: 0 }, i / 30);       // 0.5 s poor
  for (let i = 45; i < 60; i++) tr.push({ score: 0.8, bones: bones(0.8), lag: 0 }, i / 30);       // 0.5 s good
  const s = tr.summary();
  assert.equal(s.frames, 60);
  assert.ok(Math.abs(s.score - (30 + 3 + 12) / 60) < 1e-9);
  assert.ok(Math.abs(s.bones.torso - s.score) < 1e-9);
  assert.ok(Math.abs(s.streak - 29 / 30) < 0.01);
  assert.ok(Math.abs(s.lag - 0.05) < 1e-9);
  assert.equal(new MatchTracker().summary().score, 0);
  assert.equal(grade(0.95), "Perfect");
  assert.equal(grade(0.1), "Keep going");
});
