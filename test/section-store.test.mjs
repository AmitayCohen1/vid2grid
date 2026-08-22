import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const SectionStore = createRequire(import.meta.url)("../public/movement-languages/section-store.js");

const pose = () => ({
  x: 0, z: 0, facing: 0, hipY: 0.95,
  bones: Object.fromEntries(
    ["torso","head","ruarm","rfarm","luarm","lfarm","rthigh","rshin","lthigh","lshin"].map((id) => [id, [0, -45]]),
  ),
});
const section = (id, beats, nKeys) => ({
  v: 1, id, name: "s" + id, createdAt: 1, tempo: 100, beats,
  source: { file: "f", startSec: 0, endSec: 1 },
  keys: Array.from({ length: nKeys }, (_, i) => ({ beat: i * 0.25, pose: pose() })),
});

test("validateSection matches the TS twin's rules", () => {
  SectionStore.validateSection(section("a", 4, 3));
  assert.throws(() => SectionStore.validateSection({ ...section("a", 4, 3), v: 2 }));
  assert.throws(() => SectionStore.validateSection(section("a", 9, 3)));
});

test("validateSection rejects a section missing source", () => {
  const s = section("a", 4, 3);
  delete s.source;
  assert.throws(() => SectionStore.validateSection(s));
});

test("validateSection rejects a section missing createdAt", () => {
  const s = section("a", 4, 3);
  delete s.createdAt;
  assert.throws(() => SectionStore.validateSection(s));
});

test("buildChoreographyKeys concatenates with repeats and reports missing", () => {
  const a = section("a", 2, 2), b = section("b", 4, 3);
  const { keys, totalBeats, missing } = SectionStore.buildChoreographyKeys(
    [{ sectionId: "a", repeat: 2 }, { sectionId: "gone", repeat: 1 }, { sectionId: "b", repeat: 1 }],
    { a, b },
  );
  assert.equal(totalBeats, 2 + 2 + 4);
  assert.deepEqual(missing, ["gone"]);
  assert.deepEqual(keys.map((k) => k.beat), [0, 0.25, 2, 2.25, 4, 4.25, 4.5]);
  keys[0].pose.bones.torso[0] = 99;               // clones, not references
  assert.equal(a.keys[0].pose.bones.torso[0], 0);
});
