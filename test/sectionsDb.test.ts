import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { putSection, listSections, deleteSection, putChoreography, listChoreographies } from "../lib/sectionsDb";
import { poseToSectionPose, type Section } from "../lib/sectionize";
import { mkPose } from "./helpers";

function mkSection(id: string, createdAt: number): Section {
  return {
    v: 1, id, name: "s-" + id, createdAt, tempo: 100, beats: 4,
    source: { file: "f", startSec: 0, endSec: 2.4 },
    keys: [{ beat: 0, pose: poseToSectionPose(mkPose(0)) }],
  };
}

test("put/list/delete sections round-trips, newest first", async () => {
  await putSection(mkSection("a", 1));
  await putSection(mkSection("b", 2));
  let all = await listSections();
  assert.deepEqual(all.map((s) => s.id), ["b", "a"]);
  await deleteSection("a");
  all = await listSections();
  assert.deepEqual(all.map((s) => s.id), ["b"]);
});

test("putSection rejects (not throws) on invalid sections", async () => {
  const bad = { ...mkSection("x", 3), beats: 9 };
  await assert.rejects(putSection(bad), /beats/);
});

test("choreographies store round-trips", async () => {
  await putChoreography({ v: 1, id: "c1", name: "Study", tempo: 100, items: [{ sectionId: "b", repeat: 2 }] });
  const all = await listChoreographies();
  assert.equal(all[0].items[0].repeat, 2);
});
