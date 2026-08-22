import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION_BONE_IDS, poseToSectionPose, validateSection, wrap180, quantizeKeys, makeSection } from "../lib/sectionize";
import { mkPose } from "./helpers";
import { DEFAULT_GRID } from "../lib/grid";
import { DEFAULT_SMOOTH, type Score } from "../lib/score";
import { BONES } from "../lib/skeleton";

test("wrap180 wraps into [-180,180)", () => {
  assert.equal(wrap180(0), 0);
  assert.equal(wrap180(190), -170);
  assert.equal(wrap180(-190), 170);
  assert.equal(wrap180(180), -180);
  assert.equal(wrap180(350), -10);
});

test("poseToSectionPose keeps exactly the ten core bones and wraps angles", () => {
  const sp = poseToSectionPose(mkPose(1, 350));
  assert.deepEqual(Object.keys(sp.bones).sort(), [...SECTION_BONE_IDS].sort());
  assert.equal(sp.bones.torso[0], -10);          // 350 → −10
  assert.equal(sp.bones.torso[1], -45);
  assert.equal(sp.facing, -10);                  // 350 → −10
  assert.equal(sp.hipY, 0.95);
});

test("validateSection accepts a good section and rejects bad ones", () => {
  const good = {
    v: 1, id: "a", name: "s", createdAt: 1, tempo: 100, beats: 4,
    source: { file: "f.mp4", startSec: 0, endSec: 2.4 },
    keys: [{ beat: 0, pose: poseToSectionPose(mkPose(0)) }, { beat: 1.25, pose: poseToSectionPose(mkPose(1)) }],
  };
  assert.equal(validateSection(good).beats, 4);
  assert.throws(() => validateSection({ ...good, v: 2 }), /version/);
  assert.throws(() => validateSection({ ...good, beats: 9 }), /beats/);
  assert.throws(() => validateSection({ ...good, keys: [] }), /beat 0/);
  assert.throws(() => validateSection({ ...good, keys: [{ beat: 0.1, pose: good.keys[0].pose }] }), /quarter/);
  assert.throws(() => validateSection({ ...good, createdAt: undefined }), /createdAt/);
  assert.throws(() => validateSection({ ...good, source: undefined }), /source/);
  assert.throws(() => validateSection({ ...good, source: { ...good.source, file: 7 } }), /source/);
  assert.throws(() => validateSection({ ...good, source: { ...good.source, startSec: "0" } }), /source/);
  assert.throws(() => validateSection({ ...good, source: { ...good.source, endSec: null } }), /source/);
});

function mkScore(keyframeTimes: number[], fps = 30, duration = 4): Score {
  const n = Math.round(duration * fps);
  const frames = Array.from({ length: n }, (_, i) => mkPose(i / fps, keyframeTimes.some((t) => Math.round(t * fps) === i) ? 90 : 0));
  const lengths = Object.fromEntries(BONES.map((b) => [b.id, b.len])) as Score["body"]["lengths"];
  return {
    version: 1,
    source: { name: "clip.mp4", duration, fps, width: 640, height: 480 },
    grid: DEFAULT_GRID, smooth: DEFAULT_SMOOTH, lift: "anchored",
    body: { lengths, hipWidth: 0.22, shoulderWidth: 0.36 },
    raw: frames, frames,
    keyframes: keyframeTimes.map((t) => Math.round(t * fps)),
  };
}

test("quantizeKeys snaps keyframes to the nearest quarter-beat", () => {
  // 120 bpm → beat = 0.5 s; quarter-beat = 0.125 s.
  const score = mkScore([0.0, 0.56, 1.10]);
  const { keys } = quantizeKeys(score, { bpm: 120, offsetSec: 0, startBeat: 0, lengthBeats: 4 });
  assert.deepEqual(keys.map((k) => k.beat), [0, 1.25, 2.25]);   // frame 17@17/30≈0.567s→1.133 beats→1.25; frame 33@1.1s→2.2→2.25
});

test("quantizeKeys synthesizes a beat-0 key from the window start", () => {
  const score = mkScore([1.0]);
  const { keys, srcFrames } = quantizeKeys(score, { bpm: 60, offsetSec: 0, startBeat: 0, lengthBeats: 4 });
  assert.equal(keys[0].beat, 0);
  assert.equal(srcFrames[0], 0);
  assert.equal(keys.length, 2);
});

test("quantizeKeys drops keys outside the window and keeps beats < lengthBeats", () => {
  const score = mkScore([0.0, 0.5, 3.9]);   // at 60 bpm window of 2 beats: 3.9 s is outside
  const { keys } = quantizeKeys(score, { bpm: 60, offsetSec: 0, startBeat: 0, lengthBeats: 2 });
  assert.ok(keys.every((k) => k.beat >= 0 && k.beat < 2));
});

test("collision on one quarter-beat keeps the larger pose change", () => {
  // Two keyframes 0.05 s apart both snap to beat 1 at 60 bpm.
  const score = mkScore([1.0, 1.05]);
  const { keys, srcFrames } = quantizeKeys(score, { bpm: 60, offsetSec: 0, startBeat: 0, lengthBeats: 4 });
  const atBeat1 = keys.filter((k) => k.beat === 1);
  assert.equal(atBeat1.length, 1);
  assert.equal(srcFrames.filter((_, i) => keys[i].beat === 1).length, 1);
});

test("makeSection fills meta and validates", () => {
  const score = mkScore([0.0, 0.5]);
  const s = makeSection(score, { bpm: 120, offsetSec: 0.1, startBeat: 0, lengthBeats: 4 }, "test cut");
  assert.equal(s.beats, 4);
  assert.equal(s.tempo, 120);
  assert.equal(s.source.file, "clip.mp4");
  assert.ok(Math.abs(s.source.startSec - 0.1) < 1e-9);
  assert.ok(Math.abs(s.source.endSec - (0.1 + 4 * 0.5)) < 1e-9);
  validateSection(s);   // throws if malformed
});
