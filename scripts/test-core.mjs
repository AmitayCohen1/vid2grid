import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

// Run the pure TypeScript engine with the project's existing compiler, without a test dependency.
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { createDemo, DEMO_PHRASES } = require("../lib/demo.ts");
const { parseScore, serializeScore, snapPoses, frameAt } = require("../lib/score.ts");
const { fillGaps } = require("../lib/tracker.ts");
const { forwardKinematics } = require("../lib/fk.ts");

test("every authored study round-trips and produces finite 3D joint positions", () => {
  for (const phrase of DEMO_PHRASES) {
    const score = parseScore(serializeScore(createDemo(phrase.id)));
    assert.equal(score.frames.length, 240);
    assert.ok(score.keyframes.length > 1);
    for (const pose of score.frames) {
      for (const p of Object.values(forwardKinematics(pose, score.body))) {
        assert.ok([p.x, p.y, p.z].every(Number.isFinite));
      }
    }
    assert.equal(frameAt(score, -10), 0);
    assert.equal(frameAt(score, 100), 239);
  }
});

test("invalid imports fail at the boundary instead of crashing the studio", () => {
  for (const value of [null, {}, { version: 1, frames: [], source: {} }]) {
    assert.throws(() => parseScore(JSON.stringify(value)), /invalid/);
  }
  const mutations = [
    (s) => { s.frames = []; },
    (s) => { s.raw.pop(); },
    (s) => { s.grid.azStep = 0; },
    (s) => { s.grid.minDwell = 0; },
    (s) => { s.source.fps = 0; },
    (s) => { s.raw[0].bones.torso = null; },
    (s) => { s.raw[0].conf = 2; },
    (s) => { s.frames[0].x = null; },
    (s) => { s.body.lengths.torso = -1; },
    (s) => { s.keyframes = [9999]; },
    (s) => { s.frames[1].t = 0; },
    (s) => { s.frames[0].bones.head[1] = 100; },
  ];
  for (const mutate of mutations) {
    const s = createDemo(); mutate(s);
    assert.throws(() => parseScore(JSON.stringify(s)), /invalid/);
  }
  assert.throws(() => parseScore("not json"), /valid JSON/);
});

test("legacy v1 scores restore the default lifting mode", () => {
  const s = createDemo(); delete s.lift;
  assert.equal(parseScore(JSON.stringify(s)).lift, "anchored");
});

test("one-frame dwell accepts a change immediately; longer dwell filters an isolated spike", () => {
  const s = createDemo();
  const raw = s.raw.slice(0, 4).map((p) => ({ ...p, bones: { ...p.bones, ruarm: [90, 0] } }));
  raw[1].bones.ruarm = [180, 0];
  const quick = snapPoses(raw, { ...s.grid, minDwell: 1 });
  const stable = snapPoses(raw, { ...s.grid, minDwell: 3 });
  assert.equal(quick.frames[1].bones.ruarm[0], 180);
  assert.equal(quick.frames[2].bones.ruarm[0], 90);
  assert.equal(stable.frames[1].bones.ruarm[0], 90);
  assert.equal(raw[1].bones.ruarm[0], 180);
});

test("leading and interior tracking gaps preserve source-frame alignment and mark uncertainty", () => {
  const pose = createDemo().raw[0];
  const extraction = { pose };
  const tracked = [null, null, extraction, null, extraction].map((extraction) => ({ extraction, image: null }));
  const result = fillGaps(tracked, 30);
  assert.equal(result.length, tracked.length);
  assert.deepEqual(result.map((e) => e.pose.t), [0, 1 / 30, 2 / 30, 3 / 30, 4 / 30]);
  assert.deepEqual(result.map((e) => e.pose.conf), [0, 0, 1, 0, 1]);
  assert.deepEqual(fillGaps([{ extraction: null, image: null }], 30), []);
  assert.equal(pose.conf, 1);
});
