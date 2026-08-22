import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION_BONE_IDS, poseToSectionPose, validateSection, wrap180 } from "../lib/sectionize";
import { mkPose } from "./helpers";

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
